/**
 * GL matte — the sharp-edge stage.
 *
 * WHY THIS EXISTS: every segmentation model here outputs a small, soft mask.
 * The old path stretched that mask to full size and then blurred it further
 * (feather + despeckle + temporal blend), which is exactly why edges looked
 * soft. This stage does the opposite: it uses the FULL-RESOLUTION camera frame
 * as a guide, so the mask edge snaps onto real hair/shoulder/clothing edges.
 *
 * Three GPU passes, all free (no model, no network, no server):
 *  A. Motion-adaptive temporal smoothing at MASK resolution (cheap). Small
 *     frame-to-frame changes are averaged out (kills flicker); big changes
 *     (you moved) pass straight through (no ghost trail). Smoothing the small
 *     mask and THEN upsampling keeps the final edge sharp, unlike smoothing
 *     the already-blurred full-size mask.
 *  B. Joint bilateral upsampling: each output pixel takes a weighted average
 *     of nearby mask cells, weighted by how similar the full-res camera colour
 *     is at that cell vs. at this pixel. Mask edge follows image edges.
 *     Then the alpha is tightened with smoothstep, and edge pixels get
 *     foreground colour decontamination (removes the halo of old background
 *     colour that bleeds through semi-transparent edge pixels).
 *  C. Optional clean-plate assist: if the user captured an empty-room frame
 *     (fixed studio camera), uncertain edge pixels that still match the plate
 *     are pushed to background. Confident person pixels are never touched.
 *
 * Output: a canvas holding PREMULTIPLIED foreground (rgb*a, a). Draw it over
 * the environment with normal source-over. If WebGL2 is unavailable or fails,
 * `ok` is false and render-core keeps using the legacy canvas path.
 */
(function () {
  function scratchCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w || 1, h || 1);
    const c = document.createElement('canvas');
    c.width = w || 1; c.height = h || 1;
    return c;
  }

  const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // Pass A: mask-resolution temporal smoothing. Writes the smoothed value to all channels.
  const FRAG_SMOOTH = `#version 300 es
precision highp float;
uniform sampler2D uNew;
uniform sampler2D uPrev;
uniform vec2 uMaskSize;
uniform float uBase;    // base weight on the NEW frame (0..1)
uniform float uAdapt;   // extra weight per unit of change, so motion passes through
uniform float uReset;   // 1.0 = no history, take the new frame as-is
out vec4 o;
void main() {
  vec2 t = gl_FragCoord.xy / uMaskSize;
  float n = texture(uNew, t).a;
  float p = texture(uPrev, t).r;
  float w = clamp(uBase + uAdapt * abs(n - p), 0.0, 1.0);
  w = max(w, uReset);
  float s = mix(p, n, w);
  o = vec4(s, s, s, s);
}`;

  // Pass B(+C): guided upsample, tighten, decontaminate, plate assist.
  const FRAG_UP = `#version 300 es
precision highp float;
uniform sampler2D uGuide;   // full-res camera frame (mipmapped)
uniform sampler2D uMask;    // smoothed mask (mask resolution)
uniform sampler2D uPlate;   // optional clean plate, same size as output
uniform vec2 uRes;          // output size in px
uniform vec2 uMaskSize;
uniform float uLod;         // mip level ~ one mask cell in guide pixels
uniform int uRadius;        // 1 = 3x3 taps, 2 = 5x5 taps
uniform float uSigmaR;      // colour similarity; lower = edges follow image detail harder
uniform float uLo;
uniform float uHi;
uniform float uDespill;     // 0..1 edge colour decontamination
uniform float uPlateStrength;
uniform float uHavePlate;
out vec4 outColor;

void main() {
  vec2 v = gl_FragCoord.xy / uRes;
  vec2 t = vec2(v.x, 1.0 - v.y);           // image row 0 is the top
  vec3 c0 = texture(uGuide, t).rgb;

  vec2 pm = t * uMaskSize;                 // this pixel in mask-cell units
  vec2 base = floor(pm) + 0.5;

  float sum = 0.0, wsum = 0.0;
  vec3 bgSum = vec3(0.0);
  float bgW = 0.0;
  float inv2s = 1.0 / (2.0 * uSigmaR * uSigmaR);

  for (int j = -uRadius; j <= uRadius; j++) {
    for (int i = -uRadius; i <= uRadius; i++) {
      vec2 cen = base + vec2(float(i), float(j));
      vec2 st = cen / uMaskSize;
      vec2 d = pm - cen;
      float ws = exp(-dot(d, d));                          // spatial weight
      vec3 cs = textureLod(uGuide, st, uLod).rgb;          // cell's average colour
      vec3 dc = cs - c0;
      float wr = exp(-dot(dc, dc) * inv2s);                // colour weight
      float w = ws * wr + 0.0001;
      float m = texture(uMask, st).r;
      sum += w * m;
      wsum += w;
      float wb = ws * (1.0 - m);
      bgSum += wb * cs;
      bgW += wb;
    }
  }

  float a = sum / wsum;

  // C. clean-plate assist: only in uncertain zone, never on confident person pixels
  if (uHavePlate > 0.5) {
    float diff = length(c0 - texture(uPlate, t).rgb);
    float pl = smoothstep(0.06, 0.18, diff);
    float uncertain = 1.0 - smoothstep(0.80, 0.98, a);
    a *= mix(1.0, pl, uPlateStrength * uncertain);
  }

  a = smoothstep(uLo, uHi, a);

  // Edge colour decontamination: C = a*F + (1-a)*B  =>  F = (C - (1-a)*B) / a
  vec3 fg = c0;
  if (uDespill > 0.0 && bgW > 0.001) {
    vec3 B = bgSum / bgW;
    vec3 F = clamp((c0 - (1.0 - a) * B) / max(a, 0.3), 0.0, 1.0);
    float edge = clamp(4.0 * a * (1.0 - a), 0.0, 1.0);
    fg = mix(c0, F, uDespill * edge);
  }
  outColor = vec4(fg * a, a);
}`;

  class GLMatte {
    constructor() {
      this.ok = false;
      this.error = null;
      // Tunables (all changeable live via render-core 'setMatte')
      this.radius = 1;          // 1 = fast (3x3), 2 = quality (5x5)
      this.sigmaR = 0.12;
      this.edgeLo = 0.30;
      this.edgeHi = 0.70;
      this.despill = 0.6;
      this.smoothBase = 0.45;   // weight on the new frame when nothing moves
      this.smoothAdapt = 2.0;   // motion passes through faster
      this.plateStrength = 0.7;

      this.canvas = scratchCanvas(2, 2);
      this.gl = null;
      this._maskW = 0; this._maskH = 0;
      this._guideW = 0; this._guideH = 0;
      this._plateW = 0; this._plateH = 0;
      this._havePlate = false;
      this._hasHistory = false;
      this._flip = 0;
      this._init();
    }

    _init() {
      try {
        const gl = this.canvas.getContext('webgl2', {
          alpha: true, premultipliedAlpha: true, antialias: false,
          depth: false, stencil: false, preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        });
        if (!gl) throw new Error('WebGL2 not available');
        this.gl = gl;
        this._progSmooth = this._program(VERT, FRAG_SMOOTH);
        this._progUp = this._program(VERT, FRAG_UP);
        this._uS = this._uniforms(this._progSmooth, ['uNew', 'uPrev', 'uMaskSize', 'uBase', 'uAdapt', 'uReset']);
        this._uU = this._uniforms(this._progUp, ['uGuide', 'uMask', 'uPlate', 'uRes', 'uMaskSize', 'uLod', 'uRadius',
          'uSigmaR', 'uLo', 'uHi', 'uDespill', 'uPlateStrength', 'uHavePlate']);

        this._texGuide = this._tex(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
        this._texMaskIn = this._tex(gl.LINEAR, gl.LINEAR);
        this._texPlate = this._tex(gl.LINEAR, gl.LINEAR);
        this._texSm = [this._tex(gl.LINEAR, gl.LINEAR), this._tex(gl.LINEAR, gl.LINEAR)];
        this._fbo = [gl.createFramebuffer(), gl.createFramebuffer()];

        this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; this.error = 'WebGL context lost'; });
        this.ok = true;
      } catch (e) {
        this.ok = false;
        this.error = e && e.message ? e.message : String(e);
      }
    }

    _program(vs, fs) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('GL shader: ' + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('GL link: ' + gl.getProgramInfoLog(p));
      return p;
    }

    _uniforms(prog, names) {
      const o = {};
      for (const n of names) o[n] = this.gl.getUniformLocation(prog, n);
      return o;
    }

    _tex(minFilter, magFilter) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    resize(w, h) {
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      // Plate must match output size; a resize invalidates it.
      this._havePlate = false;
      this._hasHistory = false;
    }

    /** Drop temporal history (e.g. camera switched). */
    reset() { this._hasHistory = false; }

    /** Upload an empty-room frame (ImageBitmap/canvas at output size). */
    setPlate(source) {
      if (!this.ok || !source) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this._texPlate);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this._havePlate = true;
    }

    clearPlate() { this._havePlate = false; }

    /**
     * @param guide  ImageBitmap of the camera frame at output size (w x h)
     * @param mask   ImageBitmap of the model mask (any size; alpha = person confidence)
     * @returns the canvas holding premultiplied foreground, or null if unusable
     */
    process(guide, mask, w, h) {
      if (!this.ok) return null;
      const gl = this.gl;
      if (this.canvas.width !== w || this.canvas.height !== h) this.resize(w, h);

      const mw = mask.width, mh = mask.height;
      if (!mw || !mh) return null;

      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.disable(gl.BLEND);

      // upload guide (+ mipmaps: the coarse level = average colour of one mask cell)
      gl.bindTexture(gl.TEXTURE_2D, this._texGuide);
      if (this._guideW !== guide.width || this._guideH !== guide.height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, guide);
        this._guideW = guide.width; this._guideH = guide.height;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, guide);
      }
      gl.generateMipmap(gl.TEXTURE_2D);

      // upload mask
      gl.bindTexture(gl.TEXTURE_2D, this._texMaskIn);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);

      // (re)allocate smoothing targets when mask size changes
      if (this._maskW !== mw || this._maskH !== mh) {
        for (let i = 0; i < 2; i++) {
          gl.bindTexture(gl.TEXTURE_2D, this._texSm[i]);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mw, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[i]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._texSm[i], 0);
        }
        this._maskW = mw; this._maskH = mh;
        this._hasHistory = false;
      }

      // ---- Pass A: temporal smoothing at mask resolution ----
      const prevIdx = this._flip, nextIdx = 1 - this._flip;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo[nextIdx]);
      gl.viewport(0, 0, mw, mh);
      gl.useProgram(this._progSmooth);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._texMaskIn);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._texSm[prevIdx]);
      gl.uniform1i(this._uS.uNew, 0);
      gl.uniform1i(this._uS.uPrev, 1);
      gl.uniform2f(this._uS.uMaskSize, mw, mh);
      gl.uniform1f(this._uS.uBase, this.smoothBase);
      gl.uniform1f(this._uS.uAdapt, this.smoothAdapt);
      gl.uniform1f(this._uS.uReset, this._hasHistory ? 0.0 : 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this._flip = nextIdx;
      this._hasHistory = true;

      // ---- Pass B/C: guided upsample to the canvas ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this._progUp);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._texGuide);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._texSm[nextIdx]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._texPlate);
      gl.uniform1i(this._uU.uGuide, 0);
      gl.uniform1i(this._uU.uMask, 1);
      gl.uniform1i(this._uU.uPlate, 2);
      gl.uniform2f(this._uU.uRes, w, h);
      gl.uniform2f(this._uU.uMaskSize, mw, mh);
      gl.uniform1f(this._uU.uLod, Math.max(0, Math.log2(Math.max(1, w / mw))));
      gl.uniform1i(this._uU.uRadius, this.radius >= 2 ? 2 : 1);
      gl.uniform1f(this._uU.uSigmaR, this.sigmaR);
      gl.uniform1f(this._uU.uLo, this.edgeLo);
      gl.uniform1f(this._uU.uHi, this.edgeHi);
      gl.uniform1f(this._uU.uDespill, this.despill);
      gl.uniform1f(this._uU.uPlateStrength, this.plateStrength);
      gl.uniform1f(this._uU.uHavePlate, this._havePlate ? 1.0 : 0.0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      return this.canvas;
    }
  }

  globalThis.VS = globalThis.VS || {};
  globalThis.VS.GLMatte = GLMatte;
})();

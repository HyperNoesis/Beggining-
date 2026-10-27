OPTIONAL BUT RECOMMENDED: host the MODNet model yourself.

Put the MODNet ONNX file in this folder and name it exactly:   modnet.onnx

The studio tries this file first (same site = fastest, most reliable, works if a
third-party host is down). If it is missing, it falls back to Hugging Face
downloads, and if those fail it uses the lighter MediaPipe model automatically.

Where to get it (Apache-2.0 licensed):
  - Hugging Face: Xenova/modnet  ->  onnx/model.onnx   (about 25 MB, fp32)
  - Original project: github.com/ZHKKKe/MODNet  (webcam portrait matting model)

If you host the file yourself, keep a copy of the Apache-2.0 license text and the
MODNet attribution with your app (see LICENSES.md).

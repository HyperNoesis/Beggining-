/** Go Live check (pure): turns facts about the device, camera, mic, network and setup into a plain-language checklist, and live stats into a health reading. No DOM, no network. */
(function () {
  window.VS = window.VS || {};
  const num = (v) => typeof v === 'number' && isFinite(v);
  const mbps = (bps) => Math.round(bps / 1e5) / 10;
  /** Uplink needed for a bitrate: video + audio + ~30% overhead and headroom. */
  function uplinkNeedMbps(bitrate, audioBps) { return mbps(((num(bitrate) ? bitrate : 0) + (num(audioBps) ? audioBps : 128000)) * 1.3); }
  /** inp: {running, endpoint, endpointOk, secure, online, hasAudio, micDb, fps, outW, outH, bitrate, downlinkMbps, effectiveType, saveData, battery:{level,charging}|null, recording, fxTier, platform}
      Returns {items:[{id,level,text}], canGo, warns, fails}. fail = Go Live is blocked, warn = allowed with a clear note. */
  function evaluate(inp) {
    inp = inp || {}; const items = []; const add = (id, level, text) => items.push({ id, level, text });
    if (!inp.running) add('camera', 'fail', 'The camera is not running. Press Start first, then check again.'); else add('camera', 'ok', 'Camera is running.');
    if (!inp.endpoint) add('url', 'fail', 'No WHIP address yet. Finish steps 1 and 2 of the Go Live wizard.');
    else if (inp.endpointOk === false) add('url', 'fail', 'The WHIP address does not look right. It must start with https:// (or http://localhost for a relay on your own computer).');
    else add('url', 'ok', 'WHIP address is set.');
    if (inp.secure === false) add('secure', 'fail', 'This page is not on a secure (https) address, so the browser will not allow streaming.');
    if (inp.online === false) add('online', 'fail', 'You are offline. Connect to Wi-Fi or mobile data first.');
    else add('online', 'ok', 'You are online.');
    if (!inp.hasAudio) add('audio', 'warn', 'No microphone sound is going into the stream. Viewers will see you but hear nothing.');
    else if (num(inp.micDb) && inp.micDb < -60) add('audio', 'warn', 'Your microphone sounds silent. Speak and check again, or check the mute switch.');
    else if (num(inp.micDb) && inp.micDb > -3) add('audio', 'warn', 'Your microphone is very loud and may distort. Move back or lower the input level.');
    else add('audio', 'ok', 'Microphone is heard.');
    const need = uplinkNeedMbps(inp.bitrate);
    if (inp.effectiveType === 'slow-2g' || inp.effectiveType === '2g') add('net', 'fail', 'Your connection is too slow to stream video (' + inp.effectiveType + '). Move to Wi-Fi.');
    else if (num(inp.downlinkMbps) && inp.downlinkMbps < 1.5) add('net', 'warn', 'Your connection looks weak (about ' + inp.downlinkMbps + ' Mbps down). Pick a lower bitrate, such as 1.5 to 2.5 Mbps.');
    else if (inp.effectiveType === '3g') add('net', 'warn', 'Your connection reports 3G. Use a low bitrate (under 1.5 Mbps) or switch to Wi-Fi.');
    else if (num(inp.downlinkMbps)) add('net', 'ok', 'Connection looks usable (about ' + inp.downlinkMbps + ' Mbps down). Your upload speed cannot be read by the browser: you need about ' + need + ' Mbps up.');
    else add('net', 'ok', 'Your browser cannot report the connection speed. You need about ' + need + ' Mbps upload for this bitrate.');
    if (inp.saveData) add('saver', 'warn', 'Data saver is on in your browser. It can limit streaming.');
    if (num(inp.bitrate) && inp.bitrate > 4000000 && (inp.effectiveType === '3g' || (num(inp.downlinkMbps) && inp.downlinkMbps < 6))) add('bitrate', 'warn', 'The bitrate (' + mbps(inp.bitrate) + ' Mbps) is high for this connection. Quality will step down by itself, but a lower setting is steadier.');
    if (num(inp.fps) && inp.fps > 0 && inp.fps < 12) add('fps', 'warn', 'The picture is only running at about ' + Math.round(inp.fps) + ' frames per second. Turn off some effects, or run Diagnostics, Test effects speed.');
    else if (inp.fxTier === 'off') add('fps', 'warn', 'Your last speed test turned the scene effects off for this phone. That is fine, the stream will just look flatter.');
    if (inp.battery && num(inp.battery.level) && inp.battery.level < 0.2 && !inp.battery.charging) add('battery', 'warn', 'Battery is at ' + Math.round(inp.battery.level * 100) + '% and not charging. Plug in before a long stream.');
    if (inp.recording) add('rec', 'ok', 'You are also recording a copy on this device.'); else add('rec', 'warn', 'You are not recording a copy. If the stream drops, nothing is saved. Press Record too if you want a backup.');
    const fails = items.filter((i) => i.level === 'fail').length, warns = items.filter((i) => i.level === 'warn').length;
    return { items, canGo: fails === 0, fails, warns };
  }
  /** Live stats -> a plain reading. s: {kbps, fps, lossPct, rttMs, targetKbps} */
  function health(s) {
    s = s || {}; if (!num(s.kbps)) return { level: 'unknown', text: 'Measuring…' };
    let level = 'good'; const why = [];
    if (num(s.lossPct) && s.lossPct > 8) { level = 'poor'; why.push('lots of lost data (' + Math.round(s.lossPct) + '%)'); } else if (num(s.lossPct) && s.lossPct > 2) { level = 'fair'; why.push('some lost data (' + Math.round(s.lossPct) + '%)'); }
    if (num(s.rttMs) && s.rttMs > 600) { level = 'poor'; why.push('slow response (' + Math.round(s.rttMs) + ' ms)'); } else if (num(s.rttMs) && s.rttMs > 300 && level === 'good') { level = 'fair'; why.push('some delay (' + Math.round(s.rttMs) + ' ms)'); }
    if (num(s.fps) && s.fps < 10) { level = level === 'poor' ? 'poor' : 'fair'; why.push('low frame rate (' + Math.round(s.fps) + ')'); }
    if (num(s.targetKbps) && s.targetKbps > 0 && s.kbps < s.targetKbps * 0.3) { if (level === 'good') level = 'fair'; why.push('sending well below the target'); }
    const head = (level === 'good' ? 'Good' : level === 'fair' ? 'Fair' : 'Poor') + ': ' + Math.round(s.kbps) + ' kbps' + (num(s.fps) ? ', ' + Math.round(s.fps) + ' fps' : '');
    return { level, text: head + (why.length ? ' (' + why.join(', ') + ')' : '') };
  }
  window.VS.GoLiveCore = { evaluate, health, uplinkNeedMbps };
})();

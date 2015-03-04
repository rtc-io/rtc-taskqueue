var fs = require('fs');
var test = require('tape');
var sdp = {
  novideo: fs.readFileSync(__dirname + '/sdp/novideo.sdp', 'utf8'),
  video: fs.readFileSync(__dirname + '/sdp/video.sdp', 'utf8')
};
var RTCPeerConnection = require('rtc-core/detect')('RTCPeerConnection');
var RTCSessionDescription = require('rtc-core/detect')('RTCSessionDescription');
var RTCIceCandidate = require('rtc-core/detect')('RTCIceCandidate');
var pc;

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }));
});

test('can set the remote description of the pc', function(t) {
  t.plan(1);
  pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: sdp.novideo }),
    t.pass,
    t.fail
  );
});

test('applying the bad ice candidate fails', function(t) {
  t.plan(1);
  try {
    pc.addIceCandidate(new RTCIceCandidate({
      sdpMid: 'video',
      sdpMLineIndex: 1,
      candidate: '1635139038 2 udp 2121998079 10.17.130.132 52524 typ host generation 0'
    }));
  }
  catch (e) {
    t.pass('failed as expected');
  }
});

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }));
});

test('can set the remote description of the pc', function(t) {
  t.plan(1);
  pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: sdp.video }),
    t.pass,
    t.fail
  );
});

test('applying the ice candidate succeeds', function(t) {
  t.plan(1);
  try {
    pc.addIceCandidate(new RTCIceCandidate({
      sdpMid: 'video',
      sdpMLineIndex: 1,
      candidate: '1635139038 2 udp 2121998079 10.17.130.132 52524 typ host generation 0'
    }));
    t.pass('added ice candidate');
  }
  catch (e) {
    t.fail(e);
  }
});

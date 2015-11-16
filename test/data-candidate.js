var fs = require('fs');
var test = require('tape');
var detect = require('rtc-core/detect');
var queue = require('..');
var sdp = {
  nodata: fs.readFileSync(__dirname + '/sdp/nodata.sdp', 'utf8'),
  all: fs.readFileSync(__dirname + '/sdp/video-audio-data.sdp', 'utf8')
};
var RTCPeerConnection = require('rtc-core/detect')('RTCPeerConnection');
var RTCSessionDescription = require('rtc-core/detect')('RTCSessionDescription');
var RTCIceCandidate = require('rtc-core/detect')('RTCIceCandidate');
var validateCandidate = require('rtc-validator/candidate');

var candidateData = {
  sdpMid: 'data',
  sdpMLineIndex: 2,
  candidate: 'candidate:1635139038 2 udp 2121998079 10.17.130.132 52524 typ host generation 0'
};

var pc;

test('can validate candidate', function(t) {
  t.plan(1);
  t.equal(validateCandidate(candidateData).length, 0, 'no errors');
});

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }));
});

test('can set the remote description of the pc', function(t) {
  t.plan(1);
  pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: sdp.nodata }),
    t.pass,
    t.fail
  );
});

test('applying the bad ice candidate fails', function(t) {
  var candidate;

  t.plan(2);
  try {
    candidate = new RTCIceCandidate(candidateData);
    t.pass('created candidate');
    if (detect.moz) {
      pc.addIceCandidate(candidate);
      t.pass('applied candidate (which in mozilla is ok, apparently)');
    }
    else {
      pc.addIceCandidate(candidate);
      t.fail('applied candidate');
    }
  }
  catch (e) {
    t.pass('applying candidate failed as expected');
  }
});

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }));
});

test('can set the remote description of the pc', function(t) {
  t.plan(1);
  pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: sdp.all }),
    t.pass,
    t.fail
  );
});

test('applying the ice candidate succeeds', function(t) {
  var candidate;

  t.plan(2);
  try {
    candidate = new RTCIceCandidate(candidateData);
    t.pass('created candidate');

    pc.addIceCandidate(candidate);
    t.pass('added ice candidate');
  }
  catch (e) {
    t.fail(e);
  }
});

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }), 'created');
});

test('can set the remote description of the pc (2 mlines)', function(t) {
  t.plan(1);
  pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: sdp.nodata }),
    t.pass,
    t.fail
  );
});

test('a queue wrapped version of the peer connection with no data mid will not apply the data candidate', function(t) {
  t.plan(2);
  t.ok(pc = queue(pc), 'queue wrapped pc was created');

  pc.once('ice.remote.applied', function() {
    t.fail('candidate should not have been applied');
  });
  pc.once('task.expire', t.pass.bind(t.pass, 'bad addIceCandidate task expired'));

  pc.addIceCandidate(new RTCIceCandidate(candidateData));
});

test('can create a new peer connection', function(t) {
  t.plan(1);
  t.ok(pc = new RTCPeerConnection({ iceServers: [] }), 'created');
});

test('can set the remote description of the pc (3 mlines)', function(t) {
  t.plan(3);
  t.ok(pc = queue(pc));
  pc.once('negotiate.setremotedesc.ok', t.pass.bind(t, 'remote description set'));
  pc.setRemoteDescription({ type: 'offer', sdp: sdp.all }).then(function() {
    t.pass('promise resolved');
  });
});

test('a queue wrapped version of the peer connection will apply the data candidate', function(t) {
  t.plan(1);
  pc.once('ice.remote.applied', t.pass);
  console.log('add ice candidate');
  pc.addIceCandidate(new RTCIceCandidate(candidateData));
});

test('applying an invalid candidate should abort', function(t) {
  t.plan(1);
  pc.once('ice.remote.applied', t.fail);
  pc.once('task.expire', t.pass.bind(t, 'task expired'));
  console.log('add ice candidate');
  pc.addIceCandidate(new RTCIceCandidate({ candidate: 'invalid candidate'}));
});
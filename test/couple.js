var test = require('tape');
var taskqueue = require('..');
var RTCPeerConnection = require('rtc-core/detect')('RTCPeerConnection');
var waitConnected = require('rtc-core/wait-connected');
var connections = [];
var queues = [];
var offerSdp;
var answerSdp;

// require('cog/logger').enable('*');

test('can create connection:0', function(t) {
  t.plan(1);
  t.ok(connections[0] = new RTCPeerConnection({ iceServers: [] }));
});

test('can create connection:1', function(t) {
  t.plan(1);
  t.ok(connections[1] = new RTCPeerConnection({ iceServers: [] }));
});

test('can wrap the connections in queues', function(t) {
  t.plan(2);
  queues = connections.map(function(conn) {
    return taskqueue(conn, {
      sdpfilter: function(sdp) {
        return sdp;
      }
    });
  });

  t.ok(queues[0]);
  t.ok(queues[1]);
});

test('connect icecandidate event listeners so candidates are exchanged', function(t) {
  t.plan(1);
  connections[0].onicecandidate = queues[1].addIceCandidate;
  connections[1].onicecandidate = queues[0].addIceCandidate;
  t.pass('applied');
});

test('create a datachannel on connection:0 (required by moz)', function(t) {
  t.plan(1);
  connections[0].createDataChannel('test');
  t.pass('created data channel');
});

test('can create an offer using queue:0', function(t) {
  t.plan(1);
  queues[0].once('sdp.local', function(sdp) {
    t.ok(sdp, 'got sdp');
    offerSdp = sdp;
  });

  queues[0].createOffer();
});

test('can setRemoteDescription on connection:1', function(t) {
  t.plan(1);
  queues[1].once('sdp.local', function(sdp) {
    answerSdp = sdp;
    t.ok(sdp, 'got sdp');
  });

  queues[1].setRemoteDescription(offerSdp);
});

test('can setRemoteDescription on connection:0', function(t) {
  t.plan(3);
  waitConnected(connections[0], t.pass.bind(t, 'connection:0 connected'));
  waitConnected(connections[1], t.pass.bind(t, 'connection:1 connected'));

  queues[0].setRemoteDescription(answerSdp).then(function() {
    t.pass('promise resolved');
  });
});

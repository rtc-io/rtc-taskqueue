var test = require('tape');
var taskqueue = require('..');
var RTCPeerConnection = require('rtc-core/detect')('RTCPeerConnection');
var waitConnected = require('rtc-core/wait-connected');
var connections = [];
var queues = [];
var offerSdp;
var answerSdp;

// require('cog/logger').enable('*');

function timeout(fn, opts) {
  opts = opts || {};
  return setTimeout(function() { 
    fn(opts.message || 'timed out');
  }, opts.delay || 1000);
}

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
      interval: 1,
      sdpfilter: function(sdp) {
        return sdp;
      }
    });
  });

  t.ok(queues[0]);
  t.ok(queues[1]);
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

test('can queue up lots of ICE candidates and process quickly (originally ~55-60ms per candidate)', function(t) {
  var failTimer = timeout(t.fail);
  var start = Date.now();
  var expected = 100, actual = 0;
  queues[0].on('ice.remote.applied', function() {
    actual++;
    if (expected == actual) {
      clearTimeout(failTimer);
      console.log('Took %d ms to add %d candidates. Avg %d ms / candidate', Date.now() - start, expected, (Date.now() - start) / expected);
      return t.pass('All candidates added');
    }
  });

  for (var i = 0; i < expected; i++) {
    queues[0].addIceCandidate({ sdpMid: '', candidate: 'candidate:3391358738 1 udp 2122197247 2402:1800:f:6101:a5a3:613f:17c3:38d 63438 typ host generation 0'});
  }
})

test('can setRemoteDescription on connection:0', function(t) {
  t.plan(2);
  waitConnected(connections[0], t.pass.bind(t, 'connection:0 connected'));
  waitConnected(connections[1], t.pass.bind(t, 'connection:1 connected'));

  queues[0].setRemoteDescription(answerSdp);
});
var test = require('tape');
var taskqueue = require('..');
var RTCPeerConnection = require('rtc-core/detect')('RTCPeerConnection');
var connections = [];
var queues = [];

require('cog/logger').enable('*');

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
  queues = connections.map(taskqueue);
  t.ok(queues[0]);
  t.ok(queues[1]);
});

test('can create an offer using queue:0', function(t) {
  t.plan(1);
  queues[0].createOffer();
});

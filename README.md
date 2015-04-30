# rtc-taskqueue

This is a package that assists with applying actions to an `RTCPeerConnection`
in as reliable order as possible. It is primarily used by the coupling logic
of the [`rtc-tools`](https://github.com/rtc-io/rtc-tools).


[![NPM](https://nodei.co/npm/rtc-taskqueue.png)](https://nodei.co/npm/rtc-taskqueue/)

[![Build Status](https://img.shields.io/travis/rtc-io/rtc-taskqueue.svg?branch=master)](https://travis-ci.org/rtc-io/rtc-taskqueue) [![unstable](https://img.shields.io/badge/stability-unstable-yellowgreen.svg)](https://github.com/dominictarr/stability#unstable) 

## Example Usage

For the moment, refer to the simple coupling test as an example of how to use
this package (see below):

```js
var test = require('tape');
var taskqueue = require('rtc-taskqueue');
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
  t.plan(2);
  waitConnected(connections[0], t.pass.bind(t, 'connection:0 connected'));
  waitConnected(connections[1], t.pass.bind(t, 'connection:1 connected'));

  queues[0].setRemoteDescription(answerSdp);
});

```

## License(s)

### Apache 2.0

Copyright 2015 National ICT Australia Limited (NICTA)

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

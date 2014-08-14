var zip = require('whisk/zip');
var findPlugin = require('rtc-core/plugin');
var PriorityQueue = require('priorityqueuejs');

var PRIORITY_LOW = 100;
var PRIORITY_WAIT = 1000;

// priority order (lower is better)
var DEFAULT_PRIORITIES = [
  'candidate',
  'setLocalDescription',
  'setRemoteDescription',
  'createAnswer',
  'createOffer'
];

/**
  # rtc-taskqueue

  This is a package that assists with applying actions to an `RTCPeerConnection`
  in as reliable order as possible. It is primarily used by the coupling logic
  of the [`rtc-tools`](https://github.com/rtc-io/rtc-tools).

  ## Example Usage

  To be completed
**/
module.exports = function(pc, opts) {
  // create the task queue
  var queue = new PriorityQueue(orderTasks);

  // initialise task importance
  var priorities = (opts || {}).priorities || DEFAULT_PRIORITIES;

  // check for plugin usage
  var plugin = findPlugin((opts || {}).plugins);

  function applyCandidate(data, next) {
    var candidate = createIceCandidate(data);
    try {
    }
    catch (e) {
      console.warn('invalid ice candidate: ', e);
    }

    next();
  }

  function createIceCandidate(data) {
    if (plugin && typeof plugin.createIceCandidate == 'function') {
      return plugin.createIceCandidate(data);
    }

    return new RTCIceCandidate(data);
  }

  function enqueue(type, handler, checks) {
    queue.enqueue({
      type: type,
      fn: handler,
      checks: [].concat(checks || [])
    });
  }

  function isStable(pc) {
    return pc.signalingState === 'stable';
  }

  function orderTasks(a, b) {
    // apply each of the checks for each task
    var tasks = [a,b];
    var readiness = tasks.map(testReady);
    var priorities = zip([ tasks, readiness ]).map(function(task, ready) {
      var priority = priorities.indexOf(task.name);

      return ready ? (priority >= 0 ? priority : PRIORITY_LOW) : PRIORITY_WAIT;
    });
  }

  // check whether a task is ready (does it pass all the checks)
  function testReady(task) {
    return task.checks.filter(function(check) {
      return check(pc, task);
    });
  }

  // patch in the queue helper methods
  queue.addIceCandidate = enqueue('candidate', applyCandidate, [ isStable ]);
};

var debug = require('cog/logger')('rtc-taskqueue');
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

  function abortQueue(err) {
    console.error(err);
  }

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

  function enqueue(type, handler, opts) {
    return function() {
      debug('queueing: ' + type);

      queue.enq({
        args: [].slice.call(arguments),
        type: type,
        fn: handler,

        // initilaise any checks that need to be done prior
        // to the task executing
        checks: [].concat((opts || {}).checks || []),

        // initialise the pass and fail handlers
        pass: (opts || {}).pass || function() {},
        fail: (opts || {}).fail || abortQueue
      });
    };
  }

  function execMethod(task, next) {
    var fn = pc[task.name];

    if (typeof fn != 'function') {
      return next(new Error('cannot call "' + task.name + '" on RTCPeerConnection'));
    }

    fn.apply(pc, task.args.concat([ task.pass, task.fail ]));
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
  queue.addIceCandidate = enqueue('candidate', applyCandidate, {
    checks: [ isStable ]
  });

  queue.createOffer = enqueue('createOffer', execMethod, {
    pass: queue.setLocalDescription
  });

  queue.setLocalDescription = enqueue('setLocalDescription', execMethod);

  return queue;
};

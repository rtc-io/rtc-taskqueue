var debug = require('cog/logger')('rtc-taskqueue');
var zip = require('whisk/zip');
var findPlugin = require('rtc-core/plugin');
var PriorityQueue = require('priorityqueuejs');
var EventEmitter = require('eventemitter3');

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
  var tq = new EventEmitter();

  // initialise task importance
  var priorities = (opts || {}).priorities || DEFAULT_PRIORITIES;

  // check for plugin usage
  var plugin = findPlugin((opts || {}).plugins);

  // initialise state tracking
  var checkQueueTimer = 0;
  var currentTask;
  var defaultFail = tq.emit.bind(tq, 'fail');

  function abortQueue(err) {
    console.error(err);
  }

  function applyCandidate(task, next) {
    var candidate;
    var data = task.args[0];

    // if we have been passed an event, then extract the candidate from the data
    if (data.srcElement && data.candidate) {
      data = data.candidate;
    }

    // we have a null candidate, we have finished gathering candidates
    if (! data.candidate) {
      return next();
    }

    try {
      candidate = createIceCandidate(data);
      pc.addIceCandidate(candidate);
    }
    catch (e) {
      console.warn('invalid ice candidate: ', e);
    }

    next();
  }

  function checkQueue() {
    // peek at the next item on the queue
    var next = (! queue.isEmpty()) && (! currentTask) && queue.peek();
    var ready = next && testReady(next);

//     console.log('checking queue: ', currentTask, next && next.name, ready);

    // if we don't have a task ready, then abort
    if (! ready) {
      return triggerQueueCheck(100);
    }

    // update the current task (dequeue)
    currentTask = queue.deq();
    debug('running ' + currentTask.name);

    // process the task
    currentTask.fn(currentTask, function(err) {
      var fail = currentTask.fail || defaultFail;
      var pass = currentTask.pass;

      // unset the current task
      currentTask = null;

      // if errored, fail
      if (err) {
        return fail(err);
      }

      if (typeof pass == 'function') {
        return pass.apply(null, [].slice.call(arguments, 1));
      }

      triggerQueueCheck();
    });
  }

  function completeConnection() {
    if (pc.signalingState === 'have-remote-offer') {
      return tq.createAnswer();
    }
  }

  function createIceCandidate(data) {
    if (plugin && typeof plugin.createIceCandidate == 'function') {
      return plugin.createIceCandidate(data);
    }

    return new RTCIceCandidate(data);
  }

  function emitSdp(sdp) {
    tq.emit('sdp', pc.localDescription);
  }

  function enqueue(name, handler, opts) {
    return function() {
      debug('queueing: ' + name, arguments);

      queue.enq({
        args: [].slice.call(arguments),
        name: name,
        fn: handler,

        // initilaise any checks that need to be done prior
        // to the task executing
        checks: [].concat((opts || {}).checks || []),

        // initialise the pass and fail handlers
        pass: (opts || {}).pass,
        fail: (opts || {}).fail
      });

      triggerQueueCheck();
    };
  }

  function execMethod(task, next) {
    var fn = pc[task.name];

    function success() {
      next.apply(null, [null].concat([].slice.call(arguments)));
    }

    if (typeof fn != 'function') {
      return next(new Error('cannot call "' + task.name + '" on RTCPeerConnection'));
    }

    // invoke the function
    fn.apply(pc, task.args.concat([ success, next ]));
  }

  function hasLocalOrRemoteDescription(pc) {
    return pc.localDescription !== null || pc.remoteDescription !== null;
  }

  function isStable(pc) {
    return pc.signalingState === 'stable';
  }

  function orderTasks(a, b) {
    // apply each of the checks for each task
    var tasks = [a,b];
    var readiness = tasks.map(testReady);
    var taskPriorities = tasks.map(zip(readiness)).map(function(args) {
      var priority = priorities.indexOf(args[0].name);

      return args[1] ? (priority >= 0 ? priority : PRIORITY_LOW) : PRIORITY_WAIT;
    });

    return taskPriorities[1] - taskPriorities[0];
  }

  // check whether a task is ready (does it pass all the checks)
  function testReady(task) {
    return (task.checks || []).reduce(function(memo, check) {
      return memo && check(pc, task);
    }, true);
  }

  function triggerQueueCheck(wait) {
    clearTimeout(checkQueueTimer);
    checkQueueTimer = setTimeout(checkQueue, wait || 5);
  }

  // patch in the queue helper methods
  tq.addIceCandidate = enqueue('addIceCandidate', applyCandidate, {
    checks: [ isStable, hasLocalOrRemoteDescription ]
  });

  tq.setLocalDescription = enqueue('setLocalDescription', execMethod, {
    pass: emitSdp
  });

  tq.setRemoteDescription = enqueue('setRemoteDescription', execMethod, {
    pass: completeConnection
  });

  tq.createOffer = enqueue('createOffer', execMethod, {
    pass: tq.setLocalDescription
  });

  tq.createAnswer = enqueue('createAnswer', execMethod, {
    pass: tq.setLocalDescription
  });

  return tq;
};

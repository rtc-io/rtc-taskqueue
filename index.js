var detect = require('rtc-core/detect');
var findPlugin = require('rtc-core/plugin');
var PriorityQueue = require('priorityqueuejs');
var Promise = require('es6-promise').Promise;
var pluck = require('whisk/pluck');
var pluckSessionDesc = pluck('sdp', 'type');

// some validation routines
var checkCandidate = require('rtc-validator/candidate');

// the sdp cleaner
var sdpclean = require('rtc-sdpclean');
var parseSdp = require('rtc-sdp');

var PRIORITY_LOW = 100;
var PRIORITY_WAIT = 1000;

// priority order (lower is better)
var DEFAULT_PRIORITIES = [
  'createOffer',
  'setLocalDescription',
  'createAnswer',
  'setRemoteDescription',
  'addIceCandidate'
];

// define event mappings
var METHOD_EVENTS = {
  setLocalDescription: 'setlocaldesc',
  setRemoteDescription: 'setremotedesc',
  createOffer: 'offer',
  createAnswer: 'answer'
};

var MEDIA_MAPPINGS = {
  data: 'application'
};

// define states in which we will attempt to finalize a connection on receiving a remote offer
var VALID_RESPONSE_STATES = ['have-remote-offer', 'have-local-pranswer'];

/**
  Allows overriding of a function
 **/
function pluggable(pluginFn, defaultFn) {
  return (pluginFn && typeof pluginFn == 'function' ? pluginFn : defaultFn);
}

/**
  # rtc-taskqueue

  This is a package that assists with applying actions to an `RTCPeerConnection`
  in as reliable order as possible. It is primarily used by the coupling logic
  of the [`rtc-tools`](https://github.com/rtc-io/rtc-tools).

  ## Example Usage

  For the moment, refer to the simple coupling test as an example of how to use
  this package (see below):

  <<< test/couple.js

**/
module.exports = function(pc, opts) {
  opts = opts || {};
  // create the task queue
  var queue = new PriorityQueue(orderTasks);
  var tq = require('mbus')('', (opts || {}).logger);

  // initialise task importance
  var priorities = (opts || {}).priorities || DEFAULT_PRIORITIES;
  var queueInterval = (opts || {}).interval || 10;

  // check for plugin usage
  var plugin = findPlugin((opts || {}).plugins);

  // initialise state tracking
  var checkQueueTimer = 0;
  var defaultFail = tq.bind(tq, 'fail');

  // look for an sdpfilter function (allow slight mis-spellings)
  var sdpFilter = (opts || {}).sdpfilter || (opts || {}).sdpFilter;
  var alwaysParse = (opts.sdpParseMode === 'always');

  // initialise session description and icecandidate objects
  var RTCSessionDescription = (opts || {}).RTCSessionDescription ||
    detect('RTCSessionDescription');

  var RTCIceCandidate = (opts || {}).RTCIceCandidate ||
    detect('RTCIceCandidate');

  // Determine plugin overridable methods
  var createIceCandidate = pluggable(plugin && plugin.createIceCandidate, function(data) {
    return new RTCIceCandidate(data);
  });

  var createSessionDescription = pluggable(plugin && plugin.createSessionDescription, function(data) {
    return new RTCSessionDescription(data);
  });

  var qid = tq._qid = Math.floor(Math.random() * 100000);

  function abortQueue(err) {
    console.error(err);
  }

  function applyCandidate(task, next) {
    var data = task.args[0];
    // Allow selective filtering of ICE candidates
    if (opts && opts.filterCandidate && !opts.filterCandidate(data)) {
      tq('ice.remote.filtered', candidate);
      return next();
    }
    var candidate = data && data.candidate && createIceCandidate(data);

    function handleOk() {
      tq('ice.remote.applied', candidate);
      next();
    }

    function handleFail(err) {
      tq('ice.remote.invalid', candidate);
      next(err);
    }

    // we have a null candidate, we have finished gathering candidates
    if (! candidate) {
      return next();
    }

    pc.addIceCandidate(candidate, handleOk, handleFail);
  }

  function checkQueue() {
    // peek at the next item on the queue
    var next = (! queue.isEmpty()) && queue.peek();
    var ready = next && testReady(next);

    // reset the queue timer
    checkQueueTimer = 0;

    // if we don't have a task ready, then abort
    if (! ready) {
      // if we have a task and it has expired then dequeue it
      if (next && (aborted(next) || expired(next))) {
        tq('task.expire', next);
        queue.deq();
      }

      return (! queue.isEmpty()) && isNotClosed(pc) && triggerQueueCheck();
    }

    // properly dequeue task
    next = queue.deq();

    // process the task
    next.fn(next, function(err) {
      var fail = next.fail || defaultFail;
      var pass = next.pass;
      var taskName = next.name;

      // if errored, fail
      if (err) {
        console.error(taskName + ' task failed: ', err);
        return fail(err);
      }

      if (typeof pass == 'function') {
        pass.apply(next, [].slice.call(arguments, 1));
      }

      // Allow tasks to indicate that processing should continue immediately to the
      // following task
      if (next.immediate) {
        if (checkQueueTimer) clearTimeout(checkQueueTimer);
        return checkQueue();
      } else {
        triggerQueueCheck();
      }
    });
  }

  function cleansdp(desc) {
    // ensure we have clean sdp
    var sdpErrors = [];
    var sdp = desc && sdpclean(desc.sdp, { collector: sdpErrors });

    // if we don't have a match, log some info
    if (desc && sdp !== desc.sdp) {
      console.info('invalid lines removed from sdp: ', sdpErrors);
      desc.sdp = sdp;
    }

    // if a filter has been specified, then apply the filter
    if (typeof sdpFilter == 'function') {
      desc.sdp = sdpFilter(desc.sdp, pc);
    }

    return desc;
  }

  function completeConnection() {
    // Clean any cached media types now that we have potentially new remote description
    if (pc.__mediaIDs || pc.__mediaTypes) {
      // Set defined as opposed to delete, for compatibility purposes
      pc.__mediaIDs = undefined;
      pc.__mediaTypes = undefined;
    }

    if (VALID_RESPONSE_STATES.indexOf(pc.signalingState) >= 0) {
      return tq.createAnswer();
    }
  }

  function emitSdp() {
    tq('sdp.local', pluckSessionDesc(this.args[0]));
  }

  function enqueue(name, handler, opts) {
    return function() {
      var args = [].slice.call(arguments);

      if (opts && typeof opts.processArgs == 'function') {
        args = args.map(opts.processArgs);
      }

      var priority = priorities.indexOf(name);

      return new Promise(function(resolve, reject) {
          queue.enq({
          args: args,
          name: name,
          fn: handler,
          priority: priority >= 0 ? priority : PRIORITY_LOW,
          immediate: opts.immediate,
          // If aborted, the task will be removed
          aborted: false,

          // record the time at which the task was queued
          start: Date.now(),

          // initilaise any checks that need to be done prior
          // to the task executing
          checks: [ isNotClosed ].concat((opts || {}).checks || []),

          // initialise the pass and fail handlers
          pass: function() {
            if (opts && opts.pass) {
              opts.pass.apply(this, arguments);
            }
            resolve();
          },
          fail: function() {
            if (opts && opts.fail) {
              opts.fail.apply(this, arguments);
            }
            reject();
          }
        });

        triggerQueueCheck();
      });
    };
  }

  function execMethod(task, next) {
    var fn = pc[task.name];
    var eventName = METHOD_EVENTS[task.name] || (task.name || '').toLowerCase();
    var cbArgs = [ success, fail ];
    var isOffer = task.name === 'createOffer';

    function fail(err) {
      tq.apply(tq, [ 'negotiate.error', task.name, err ].concat(task.args));
      next(err);
    }

    function success() {
      tq.apply(tq, [ ['negotiate', eventName, 'ok'], task.name ].concat(task.args));
      next.apply(null, [null].concat([].slice.call(arguments)));
    }

    if (! fn) {
      return next(new Error('cannot call "' + task.name + '" on RTCPeerConnection'));
    }

    // invoke the function
    tq.apply(tq, ['negotiate.' + eventName].concat(task.args));
    fn.apply(
      pc,
      task.args.concat(cbArgs).concat(isOffer ? generateConstraints() : [])
    );
  }

  function expired(task) {
    return (typeof task.ttl == 'number') && (task.start + task.ttl < Date.now());
  }

  function aborted(task) {
    return task && task.aborted;
  }

  function extractCandidateEventData(data) {
    // extract nested candidate data (like we will see in an event being passed to this function)
    while (data && data.candidate && data.candidate.candidate) {
      data = data.candidate;
    }

    return data;
  }

  function generateConstraints() {
    var allowedKeys = {
      offertoreceivevideo: 'OfferToReceiveVideo',
      offertoreceiveaudio: 'OfferToReceiveAudio',
      icerestart: 'IceRestart',
      voiceactivitydetection: 'VoiceActivityDetection'
    };

    var constraints = {
      OfferToReceiveVideo: true,
      OfferToReceiveAudio: true
    };

    // Handle mozillas slightly different constraint requirements that are
    // enforced as of FF43
    if (detect.moz) {
      allowedKeys = {
        offertoreceivevideo: 'offerToReceiveVideo',
        offertoreceiveaudio: 'offerToReceiveAudio',
        icerestart: 'iceRestart',
        voiceactivitydetection: 'voiceActivityDetection'
      };
      constraints = {
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      };
    }

    // update known keys to match
    Object.keys(opts || {}).forEach(function(key) {
      if (allowedKeys[key.toLowerCase()]) {
        constraints[allowedKeys[key.toLowerCase()]] = opts[key];
      }
    });

    return (detect.moz ? constraints : { mandatory: constraints });
  }

  function hasLocalOrRemoteDesc(pc, task) {
    return pc.__hasDesc || (pc.__hasDesc = !!pc.remoteDescription);
  }

  function isNotNegotiating(pc) {
    return pc.signalingState !== 'have-local-offer';
  }

  function isNotClosed(pc) {
    return pc.signalingState !== 'closed';
  }

  function isStable(pc) {
    return pc.signalingState === 'stable';
  }

  function isValidCandidate(pc, data) {
    var validCandidate = (data.__valid ||
      (data.__valid = checkCandidate(data.args[0]).length === 0));

    // If the candidate is not valid, abort
    if (!validCandidate) {
      data.aborted = true;
    }
    return validCandidate;
  }

  function isConnReadyForCandidate(pc, data) {
    var sdpMid = data.args[0] && data.args[0].sdpMid;

    // remap media types as appropriate
    sdpMid = MEDIA_MAPPINGS[sdpMid] || sdpMid;

    if (sdpMid === '')
      return true;

    // Allow parsing of SDP always if required
    if (alwaysParse || !pc.__mediaTypes) {
      var sdp = parseSdp(pc.remoteDescription && pc.remoteDescription.sdp);
      // We only want to cache the SDP media types if we've received them, otherwise
      // bad things can happen
      var mediaTypes = sdp.getMediaTypes();
      if (mediaTypes && mediaTypes.length > 0) {
        pc.__mediaTypes = mediaTypes;
      }
      // Same for media IDs
      var mediaIDs = sdp.getMediaIDs();
      if (mediaIDs && mediaIDs.length > 0) {
        pc.__mediaIDs = mediaIDs;
      }
    }
    // the candidate is valid if the sdpMid matches either a known media
    // type, or media ID
    var validMediaCandidate =
      (pc.__mediaIDs && pc.__mediaIDs.indexOf(sdpMid) >= 0) ||
      (pc.__mediaTypes && pc.__mediaTypes.indexOf(sdpMid) >= 0);

    // Otherwise we abort the task
    if (!validMediaCandidate) {
      data.aborted = true;
    }
    return validMediaCandidate;
  }

  function orderTasks(a, b) {
    // apply each of the checks for each task
    var tasks = [a,b];
    var readiness = tasks.map(testReady);
    var taskPriorities = tasks.map(function(task, idx) {
      var ready = readiness[idx];
      return ready ? task.priority : PRIORITY_WAIT;
    });

    return taskPriorities[1] - taskPriorities[0];
  }

  // check whether a task is ready (does it pass all the checks)
  function testReady(task) {
    return (task.checks || []).reduce(function(memo, check) {
      return memo && check(pc, task);
    }, true);
  }

  function triggerQueueCheck() {
    if (checkQueueTimer) return;
    checkQueueTimer = setTimeout(checkQueue, queueInterval);
  }

  // patch in the queue helper methods
  tq.addIceCandidate = enqueue('addIceCandidate', applyCandidate, {
    processArgs: extractCandidateEventData,
    checks: [hasLocalOrRemoteDesc, isValidCandidate, isConnReadyForCandidate ],

    // set ttl to 5s
    ttl: 5000,
    immediate: true
  });

  tq.setLocalDescription = enqueue('setLocalDescription', execMethod, {
    processArgs: cleansdp,
    pass: emitSdp
  });

  tq.setRemoteDescription = enqueue('setRemoteDescription', execMethod, {
    processArgs: createSessionDescription,
    pass: completeConnection
  });

  tq.createOffer = enqueue('createOffer', execMethod, {
    checks: [ isNotNegotiating ],
    pass: tq.setLocalDescription
  });

  tq.createAnswer = enqueue('createAnswer', execMethod, {
    pass: tq.setLocalDescription
  });

  return tq;
};

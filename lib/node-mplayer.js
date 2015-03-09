/* jshint node:true */

// ----------------------------------------------------------------- Imports
var childProcess = require('child_process');
var events = require('events');
var fs = require('fs');
var readline = require('readline');
var mkfifo = require('mkfifo');

var _ = require('lodash');
var q = require('q');

// ----------------------------------------------------------------- Defaults
var defaults = {
  updateInterval: 1000,
  paths: {
    fifo: './.mplayer'
  }
};

// ----------------------------------------------------------------- Requirements
//
// Ensures that mplayer is installed.
//
childProcess.exec('mplayer', function(error) {
  if (error) {
    throw new Error("Mplayer encountered an error or isn't installed.");
  }
});

// ----------------------------------------------------------------- Construction
function Mplayer(options) {

  this.options = _.defaults(defaults, options);

  //
  // Extend EventEmitter.
  //
  events.EventEmitter.call(this);

  //
  // Handles the child-process' events.
  //
  this._registerStatusListener();
}

Mplayer.prototype.__proto__ = events.EventEmitter.prototype;

// ----------------------------------------------------------------- Public interface
// ---------------------------------------------------------- Initialization
Mplayer.prototype.setFile = function(file, options) {
  if (!fs.existsSync(file)) {
    throw new Error("File '" + file + "' not found!");
  }

  this.initialize(file, options);

  return this;
};

Mplayer.prototype.initialize = function (file, options) {

  this.info = {
    file: file,
    status: 'wait',
    time: 0,
    duration: 0,
    position: 0.0
  };

  this.options = _.extend(this.options, options);

  // Reset mode to queueing
  this._isReady = false;
  this._queue = [];

  var args = [
    '-slave',
    '-quiet',
    '-input',
    'file=' + this.options.paths.fifo,
    this.info.file
  ];

  // Cleans up an existing fifo file, that was
  // created in a previous run
  if (fs.existsSync(this.options.paths.fifo)) {
    fs.unlinkSync(this.options.paths.fifo);
  }

  mkfifo.mkfifoSync(this.options.paths.fifo, 0755);

  // Start child-process and attach readline
  this._childProcess = childProcess.spawn('mplayer', args);
  this._readline = readline.createInterface({
    input: this._childProcess.stdout,
    output: this._childProcess.stdin
  });

  // Starts mplayer paused, i.e., waits for
  // mplayer to be loaded before starting
  // playback
  this._pipeImmediately('pause');

  // Setup event handling.
  this._setInitialState(this.options);

  this._registerEventListeners();

  // Wait for track to become ready.
  var self = this;
  q.all([
    this.getTimePosition(),
    this.getTimeLength()
  ])
    .then(function () {
      self._isReady = true;
      self._emit('ready');
    });
};

// ---------------------------------------------------------- Playback
Mplayer.prototype.play = function() {
  if (!this.info.file) {
    throw new Error('No playback file has been set. Use setTrack before starting playback.');
  }

  var self = this;

  this._pipe('play')
    .then(function () {
      self._emit('play');
      self._startTimePositionPolling();
    });

  return this;
};

Mplayer.prototype.stop = function() {
  var self = this;

  this._pipe('stop')
    .then(function () {
      self._emit('stop');
    });

  return this;
};

Mplayer.prototype.pause = function() {
  var self = this;

  this._pipe('pause')
    .then(function () {
      if (self.getStatus() === 'pause') {
        self._emit('play');
      }
      else {
        self._emit('pause');
      }
    });

  return this;
};

Mplayer.prototype.seek = function (time) {
  var self = this;

  q.all([
    this.mute(),
    this._pipe('seek', time),
    this.mute()
  ])
    .then(function () {
      self._emit('seek');
    });

  return this;
};

Mplayer.prototype.setPosition = function(time) {
  var self = this;

  q.all([
    this.mute(),
    this._pipe('seek', time, 1),
    this.mute()
  ])
    .then(function () {
      self._emit('seek');
    });

  return this;
};

Mplayer.prototype.setTime = function(time) {
  var self = this;

  q.all([
    this.mute(),
    this._pipe('seek', time, 2),
    this.mute()
  ])
    .then(function () {
      self._emit('seek');
    });

  return this;
};

// ---------------------------------------------------------- Volume
Mplayer.prototype.mute = function() {
  this._pipe('mute');
  return this;
};

Mplayer.prototype.setVolume = function(volume) {
  this._pipe('volume', volume, 1);
  return this;
};

Mplayer.prototype.increaseVolume = function (volume) {
  this._pipe('volume', volume);
  return this;
};

Mplayer.prototype.decreaseVolume = function (volume) {
  this._pipe('volume', -volume);
  return this;
};


// ---------------------------------------------------------- Properties
Mplayer.prototype.setLoop = function(times) {
  this._pipe('loop', times);
  return this;
};

Mplayer.prototype.setSpeed = function(speed) {
  this._pipe('speed_set', speed);
  return this;
};


// ---------------------------------------------------------- Status queries
Mplayer.prototype.getStatus = function (callback) {
  if (callback) {
    callback(this.info.status);
  }

  return q.resolve(this.info.status);
};

Mplayer.prototype.getTimeLength = function(callback) {
  var deferred = q.defer();

  this.once('duration', function (info) {
    if (callback) {
      callback(info.duration);
    }
    deferred.resolve(info.duration);
  });

  this._pipeImmediately('get_time_length');

  return deferred.promise;
};

Mplayer.prototype.getTimePosition = function(callback) {


  if (!this._timePositionPromise) {

    this._timePositionPromise = q.defer();

    this.once('time', function (info) {
      if (callback) {
        callback(info.time);
      }

      this._timePositionPromise.resolve(info.time);
    });

    this._pipeImmediately('get_time_pos');
  }

  return this._timePositionPromise.promise;
};

Mplayer.prototype.getVolume = function (callback) {
  var deferred = q.defer();

  this.once('volume', function (info) {
    if (callback) {
      callback(info.volume);
    }
    deferred.resolve(info.volume);
  });

  this._pipe('get_property', 'volume');

  return deferred.promise;
};

// ----------------------------------------------------------------- Private methods
Mplayer.prototype._pipe = function () {

  if (!this.info.file) {
    throw new Error('No file set. Use "setTrack()" before using this media-player instance.');
  }

  // In case the player has not been initialized
  // with a track queue commands and apply
  // once the mplayer instance has become ready.
  if (!this._isReady) {
    if (!this._readyStateListener) {
      this._readyStateListener =
        this.on('ready', _.bind(this._onReady, this));
    }

    var deferred = q.defer();

    this._queue.push({
      args: _.toArray(arguments),
      promise: deferred
    });

    return deferred.promise;
  }

  this._pipeImmediately.apply(this, arguments);

  return q.resolve(this.info);
};

Mplayer.prototype._pipeImmediately = function () {

  var args = _.toArray(arguments);

  var command = _.first(args);

  //
  // Ensures that current playback status
  // is honoured by the command.
  // "pausing_keep_force" ensures that
  // the command is applied without leaving the
  // pause loop, see: http://www.mplayerhq.hu/DOCS/tech/slave.txt
  //
  // As not all commands work as expected with "pausing_keep_force"
  // we have to degrade those to "pausing_keep" that don't.
  //
  switch (command) {
    case 'seek':
      flag = 'pausing_keep';
      break;
    default:
      flag = 'pausing_keep_force';
      break;
  }

  childProcess.exec('echo "' + flag + ' ' + args.join(' ') + '\n" > ' + this.options.paths.fifo);
};

Mplayer.prototype._emit = function (event) {
  this.emit(event, this.info);

  return this;
};

Mplayer.prototype._onReady = function () {
  while (this._queue.length) {
    var current = this._queue.shift();

    this._pipe.apply(this, current.args);
    current.promise.resolve(this.info);
  }

  this._readyStateListener = null;
};

var count = 0;

Mplayer.prototype._startTimePositionPolling = function () {

  if (!this.options.updateInterval) {
    return;
  }

  var self = this;

  function poll () {
    self.getTimePosition()
      .then(function (time) {
        console.log('poll', count++, time, self.options.updateInterval);
        setTimeout(poll, self.options.updateInterval);
      });
  }

  poll();
};

Mplayer.prototype._registerEventListeners = function () {
  var self = this;

  this._childProcess.on('error', _.bind(this._handleError, this));
  this._childProcess.on('exit', _.bind(this._handleExit, this));

  this._readline.on('line', _.bind(this._handleStateChange, this));
};

Mplayer.prototype._handleStateChange = function (line) {

  if (/ANS_LENGTH=/.test(line)) {
    var duration = line.split('=')[1];

    this.info.duration = duration;
    this._emit('duration');
  }
  else if (/ANS_TIME_POSITION=/.test(line)) {
    var time = line.split('=')[1];

    this.info.time = time;
    this.info.position = this.info.duration ? this.info.time / this.info.duration : 0.0;

    this._emit('time');
  }
  else if (/ANS_volume=/.test(line)) {
    var volume = line.split('=')[1];

    this.info.volume = volume;

    this._emit('volume');
  }
};

Mplayer.prototype._handleError = function(error) {
  this.emit('error', {
    status: 'error',
    error: error
  });
};

Mplayer.prototype._handleExit = function(code, signature) {
  if (code === 0 && signature === null) {
    return this.emit('end', {
      status: 'success',
      exitCode: code
    });
  }

  this.emit('end', {
    status: 'error',
    exitCode: code
  });
};

Mplayer.prototype._registerStatusListener = function () {
  var self = this;

  function setStatus (status) {
    return function () {
      self.info.status = status;
    };
  }

  this
    .on('ready', setStatus('ready'))
    .on('play', setStatus('play'))
    .on('pause', setStatus('pause'))
    .on('stop', setStatus('stop'))
    .on('end', setStatus('end'));
  };

Mplayer.prototype._setInitialState = function (options) {

  if (options.volume !== undefined) {
    this.setVolume(options.volume);
  }

  if (options.loop !== undefined) {
    this.setLoop(options.loop);
  }

  if (options.time !== undefined) {
    this.setTime(options.time);
  }

  if (options.position !== undefined) {
    this.setPosition(options.position);
  }

  if (options.speed !== undefined) {
    this.setSpeed(options.speed);
  }

  if (options.mute) {
    this.mute();
  }
};

module.exports = Mplayer;

/* jshint node:true */
/* global describe, it, beforeEach */
'use strict';

var expect = require('chai').expect;
var Mplayer = require('../lib/node-mplayer');

var player;

describe('Using node-mplayer', function(){

  describe('after setting a file using "setTrack()"', function () {

    beforeEach(function () {
      player = new Mplayer();
    });

    it('fires a "ready" event once file has been initialized',
      function (done) {

        player.on('ready', function () {
          done();
        });

        player.setFile(__dirname + '/fixtures/sample.mp3');
      });

    it('starts playback on "play()"',
      function (done) {

        player.on('play', function () {
          done();
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .play();
      });

    it('pauses playback on "pause()"',
      function (done) {

        player.on('pause', function () {
          done();
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .play()
          .pause();
      });

    it('stops playback on "stop()"',
      function (done) {

        player.on('stop', function () {
          done();
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .play()
          .stop();
      });

    it('set the time position correctly using "setTime()"',
      function (done) {

        var isDone;

        player.on('time', function (info) {
          if (info.time >= 123 && !isDone) {
            isDone = true;
            done();
          }
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .play()
          .setTime(123);
      });

    it('set the time position correctly using "setPosition()"',
      function (done) {

        var isDone;

        player.on('time', function (info) {
          if (info.time >= info.duration / 2 && !isDone) {
            isDone = true;
            done();
          }
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .play()
          .setPosition(50);
      });


    it('sets the initial time position correctly using "setTime()"',
      function (done) {

        var isDone;

        player.on('time', function (info) {
          if (info.time >= 123 && !isDone) {
            isDone = true;
            done();
          }
        });

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .setTime(123.00)
          .play();
      });

    it('sets the volume on "setVolume()"',
      function (done) {

        var isDone;

        player.setFile(__dirname + '/fixtures/sample.mp3')
          .setVolume(50)
          .getVolume()
            .then(function (volume) {
              if (volume >= 50) {
                // done();
              }
            });
      });
  });
});
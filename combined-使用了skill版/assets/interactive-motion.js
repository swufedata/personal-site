/* JavaScript port of the oil-motion runtime controllers.

   createFrameAnimator drives frame-scrub motion with critically-damped
   smoothing and shortest-circular-path handling. It renders integer frames
   only, so a stopped pointer settles on a single clean frame with no ghosting.
   createCssSpriteRenderer draws one cell of a sprite atlas by updating
   background-position on a single element. */

(function (global) {
  "use strict";

  var clamp = function (value, min, max) {
    return Math.min(max, Math.max(min, value));
  };

  var wrap = function (value, length) {
    return ((value % length) + length) % length;
  };

  var shortestCircularDelta = function (from, to, frameCount) {
    var delta = wrap(to, frameCount) - wrap(from, frameCount);
    if (delta > frameCount / 2) delta -= frameCount;
    if (delta < -frameCount / 2) delta += frameCount;
    return delta;
  };

  var smoothDamp = function (
    current,
    target,
    velocity,
    smoothTime,
    maxSpeed,
    deltaTime
  ) {
    var safeTime = Math.max(0.0001, smoothTime);
    var omega = 2 / safeTime;
    var x = omega * deltaTime;
    var decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    var originalTarget = target;
    var maxChange = maxSpeed * safeTime;
    var change = clamp(current - target, -maxChange, maxChange);
    var limitedTarget = current - change;
    var temp = (velocity + omega * change) * deltaTime;
    var nextVelocity = (velocity - omega * temp) * decay;
    var nextPosition = limitedTarget + (change + temp) * decay;

    if (
      originalTarget - current > 0 ===
      nextPosition > originalTarget
    ) {
      nextPosition = originalTarget;
      nextVelocity = 0;
    }
    return [nextPosition, nextVelocity];
  };

  function createFrameAnimator(options) {
    var frameCount = Math.max(1, Math.floor(options.frameCount));
    var circular = options.circular || false;
    var smoothTime = options.smoothTime || 0.11;
    var maxSpeed = options.maxSpeed || frameCount * 2;
    var reducedMotion = options.reducedMotion || false;
    var position = clamp(options.initialFrame || 0, 0, frameCount - 1);
    var target = position;
    var velocity = 0;
    var lastFrame = -1;
    var lastTime = 0;
    var raf = 0;
    var destroyed = false;

    var normalizeFrame = function (frame) {
      return circular
        ? wrap(frame, frameCount)
        : clamp(frame, 0, frameCount - 1);
    };

    var render = function () {
      var frame = normalizeFrame(Math.round(normalizeFrame(position)));
      if (frame !== lastFrame) {
        options.render(frame);
        lastFrame = frame;
      }
    };

    var loop = function (now) {
      raf = 0;
      if (destroyed) return;
      var deltaTime = lastTime
        ? Math.min((now - lastTime) / 1000, 1 / 30)
        : 1 / 60;
      lastTime = now;

      if (reducedMotion) {
        position = target;
        velocity = 0;
      } else {
        var next = smoothDamp(
          position,
          target,
          velocity,
          smoothTime,
          maxSpeed,
          deltaTime
        );
        position = next[0];
        velocity = next[1];
      }
      render();

      if (Math.abs(target - position) > 0.002 || Math.abs(velocity) > 0.002) {
        raf = global.requestAnimationFrame(loop);
      } else if (circular) {
        position = wrap(position, frameCount);
        target = position;
      }
    };

    var schedule = function () {
      if (!raf && !destroyed) raf = global.requestAnimationFrame(loop);
    };

    render();

    return {
      setTarget: function (frame) {
        var normalized = normalizeFrame(frame);
        target = circular
          ? position + shortestCircularDelta(position, normalized, frameCount)
          : normalized;
        schedule();
      },
      setDirection: function (x, y, startAngle) {
        startAngle =
          startAngle === undefined ? -Math.PI * 0.75 : startAngle;
        var angle = Math.atan2(y, x);
        var turn = Math.PI * 2;
        var normalized = ((angle - startAngle + turn) % turn) / turn;
        this.setTarget(normalized * frameCount);
      },
      setProgress: function (progress) {
        this.setTarget(clamp(progress, 0, 1) * (frameCount - 1));
      },
      getCurrentFrame: function () {
        return normalizeFrame(position);
      },
      destroy: function () {
        destroyed = true;
        if (raf) global.cancelAnimationFrame(raf);
        raf = 0;
      }
    };
  }

  function createCssSpriteRenderer(element, columns, rows) {
    var safeColumns = Math.max(1, Math.floor(columns));
    var safeRows = Math.max(1, Math.floor(rows));
    element.style.backgroundSize =
      safeColumns * 100 + "% " + safeRows * 100 + "%";

    return function (frame) {
      var column = frame % safeColumns;
      var row = Math.floor(frame / safeColumns);
      var x = safeColumns === 1 ? 0 : (column / (safeColumns - 1)) * 100;
      var y = safeRows === 1 ? 0 : (row / (safeRows - 1)) * 100;
      element.style.backgroundPosition = x + "% " + y + "%";
    };
  }

  global.oilMotion = {
    createFrameAnimator: createFrameAnimator,
    createCssSpriteRenderer: createCssSpriteRenderer
  };
})(window);

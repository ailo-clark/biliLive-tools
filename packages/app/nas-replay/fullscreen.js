// Mobile fullscreen compatibility for the dedicated replay player. No URL or request rewriting.
(function () {
  "use strict";
  if (window.__bililiveNasReplayFullscreen) return;
  var mobile =
    window.matchMedia("(pointer: coarse)").matches ||
    /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!mobile) return;
  window.__bililiveNasReplayFullscreen = true;

  var style = document.createElement("style");
  style.textContent = `
.bililivewatch-fullscreen-stage { position:fixed!important; inset:0!important; width:100%!important; height:100%!important; margin:0!important; padding:0!important; overflow:hidden!important; background:#000!important; z-index:2147483647!important; }
.bililivewatch-fullscreen-stage>.art-video-player { position:absolute!important; left:50%!important; top:50%!important; width:var(--nas-player-width)!important; height:var(--nas-player-height)!important; max-width:none!important; max-height:none!important; margin:0!important; border-radius:0!important; transform:translate(-50%,-50%)!important; transform-origin:center!important; }
.bililivewatch-fullscreen-stage[data-rotated="true"]>.art-video-player { transform:translate(-50%,-50%) rotate(90deg)!important; }
.bililivewatch-fullscreen-stage .bililivewatch-fullscreen-exit { position:absolute; top:max(10px,env(safe-area-inset-top)); left:max(10px,env(safe-area-inset-left)); z-index:1000; display:grid; place-items:center; width:38px; height:38px; padding:8px; border:1px solid #ffffff55; border-radius:50%; background:#161a22cc; color:#fff; cursor:pointer; }
.bililivewatch-fullscreen-exit svg { display:block; width:22px; height:22px; pointer-events:none; }
.bililivewatch-fullscreen-stage .art-control-fullscreen .art-icon-fullscreenOn { display:none!important; }
.bililivewatch-fullscreen-stage .art-control-fullscreen .art-icon-fullscreenOff { display:inline-flex!important; }
`;
  document.head.appendChild(style);
  var active = null;
  var drag = null;
  var gesture = null;

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }
  function ignoreFailure(result) {
    if (result && typeof result.catch === "function") result.catch(function () {});
  }
  function override(saved, element, name, value) {
    var old = element.style.getPropertyValue(name);
    var priority = element.style.getPropertyPriority(name);
    element.style.setProperty(name, value, "important");
    saved.push(function () {
      // Preserve any newer host-side change to this property.
      if (
        element.style.getPropertyValue(name) !== value ||
        element.style.getPropertyPriority(name) !== "important"
      )
        return;
      if (old) element.style.setProperty(name, old, priority);
      else element.style.removeProperty(name);
    });
  }
  function expandFrame(saved) {
    // Do not move/recreate the iframe: that would reload the playing document.
    try {
      var frame = window.frameElement;
      if (!frame) return;
      var view = frame.ownerDocument.defaultView;
      [
        ["position", "fixed"],
        ["left", "0px"],
        ["top", "0px"],
        ["width", "100vw"],
        ["height", "100vh"],
        ["max-width", "none"],
        ["max-height", "none"],
        ["z-index", "2147483647"],
        ["border", "0px"],
      ].forEach(function (item) {
        override(saved, frame, item[0], item[1]);
      });
      for (var parent = frame.parentElement; parent; parent = parent.parentElement) {
        var computed = view.getComputedStyle(parent);
        ["transform", "filter", "perspective"].forEach(function (name) {
          if (computed.getPropertyValue(name) !== "none") override(saved, parent, name, "none");
        });
        if (computed.contain !== "none") override(saved, parent, "contain", "none");
        if (computed.willChange !== "auto") override(saved, parent, "will-change", "auto");
        if (computed.position === "static") override(saved, parent, "position", "relative");
        override(saved, parent, "z-index", "2147483647");
        override(
          saved,
          parent,
          "overflow",
          /^(BODY|HTML)$/.test(parent.tagName) ? "hidden" : "visible",
        );
      }
    } catch (error) {
      // A cross-origin host may forbid parent access; fullscreen inside the iframe still works.
    }
  }
  function unlock(state) {
    if (!state.locked) return;
    state.locked = false;
    try {
      screen.orientation.unlock();
    } catch (error) {}
  }
  function layout() {
    if (!active) return;
    var width = active.stage.clientWidth;
    var height = active.stage.clientHeight;
    var landscape = active.video.videoWidth > active.video.videoHeight;
    var rotated = landscape && width < height;
    if (active.rotated !== rotated) drag = gesture = null;
    active.rotated = rotated;
    active.stage.dataset.rotated = String(rotated);
    active.stage.style.setProperty("--nas-player-width", (rotated ? height : width) + "px");
    active.stage.style.setProperty("--nas-player-height", (rotated ? width : height) + "px");
    if (!landscape) unlock(active);
  }
  function lockLandscape(state) {
    if (
      active !== state ||
      state.lockRequested ||
      state.video.videoWidth <= state.video.videoHeight ||
      !screen.orientation ||
      typeof screen.orientation.lock !== "function"
    )
      return;
    state.lockRequested = true;
    try {
      Promise.resolve(screen.orientation.lock("landscape")).then(
        function () {
          state.locked = true;
          if (active !== state) unlock(state);
          else layout();
        },
        function () {
          // Android WebViews can reject orientation locks even in fullscreen.
          // Keep the CSS landscape fallback instead of showing an error over video.
          if (active === state) layout();
        },
      );
    } catch (error) {
      layout();
    }
  }
  function nativeChanged() {
    if (!active) return;
    if (fullscreenElement() === active.stage) {
      active.nativeSeen = true;
      lockLandscape(active);
      layout();
    } else if (active.nativeSeen) leave(false);
  }
  function leave(exitNative) {
    var state = active;
    if (!state) return;
    active = null;
    drag = gesture = null;
    state.observer.disconnect();
    state.resize.disconnect();
    state.video.removeEventListener("loadedmetadata", state.metadata);
    if (exitNative && fullscreenElement() === state.stage) {
      try {
        ignoreFailure((document.exitFullscreen || document.webkitExitFullscreen).call(document));
      } catch (error) {}
    }
    unlock(state);
    state.exit.remove();
    if (state.parent.isConnected) {
      state.parent.insertBefore(
        state.player,
        state.next && state.next.parentNode === state.parent ? state.next : null,
      );
    }
    state.stage.remove();
    state.saved.reverse().forEach(function (restore) {
      restore();
    });
    if (state.focus && state.focus.isConnected) {
      try {
        state.focus.focus({ preventScroll: true });
      } catch (error) {}
    }
    window.dispatchEvent(new Event("resize"));
  }
  function enter(player) {
    var video = player.querySelector("video");
    if (!video) return;
    var state = {
      player: player,
      video: video,
      parent: player.parentNode,
      next: player.nextSibling,
      focus: document.activeElement,
      saved: [],
      rotated: false,
      locked: false,
      lockRequested: false,
      nativeSeen: false,
    };
    state.stage = document.createElement("div");
    state.stage.className = "bililivewatch-fullscreen-stage";
    state.exit = document.createElement("button");
    state.exit.type = "button";
    state.exit.className = "bililivewatch-fullscreen-exit";
    state.exit.setAttribute("aria-label", "退出全屏");
    state.exit.title = "退出全屏";
    state.exit.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/></svg>';
    state.exit.addEventListener("click", function () {
      leave(true);
    });
    active = state;
    expandFrame(state.saved);
    override(state.saved, document.documentElement, "overflow", "hidden");
    override(state.saved, document.body, "overflow", "hidden");
    var playing = !video.paused;
    document.body.appendChild(state.stage);
    state.stage.appendChild(player);
    player.appendChild(state.exit);
    state.metadata = function () {
      layout();
      if (state.nativeSeen) lockLandscape(state);
    };
    video.addEventListener("loadedmetadata", state.metadata);
    state.resize = { disconnect: function () {} };
    if (typeof ResizeObserver === "function") {
      state.resize = new ResizeObserver(layout);
      state.resize.observe(state.stage);
    }
    state.observer = new MutationObserver(function () {
      if (active === state && (!player.isConnected || !state.parent.isConnected)) leave(true);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
    layout();
    // Call synchronously within the button gesture. A rejected native request
    // leaves a usable page fullscreen and never replaces the video element.
    try {
      var request = state.stage.requestFullscreen || state.stage.webkitRequestFullscreen;
      if (request) {
        var result = request.call(state.stage);
        if (result && typeof result.then === "function")
          result.then(nativeChanged, function () {
            layout();
          });
      }
    } catch (error) {
      layout();
    }
    if (playing) ignoreFailure(video.play());
  }
  function consume(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  function seek(bar, point) {
    if (!active || !Number.isFinite(active.video.duration)) return;
    var rect = bar.getBoundingClientRect();
    if (rect.height <= 0) return;
    var ratio = Math.max(0, Math.min(1, (point.clientY - rect.top) / rect.height));
    active.video.currentTime = ratio * active.video.duration;
  }
  document.addEventListener(
    "click",
    function (event) {
      var target =
        event.target.closest &&
        event.target.closest(".art-control-fullscreen, .art-control-fullscreenWeb");
      if (target) {
        var player = target.closest(".art-video-player");
        if (!player) return;
        consume(event);
        if (active) leave(true);
        else enter(player);
        return;
      }
      if (active && active.rotated) {
        var bar = event.target.closest && event.target.closest(".art-control-progress");
        if (bar && active.player.contains(bar)) {
          consume(event);
          seek(bar, event);
        }
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    function (event) {
      if (!active || !active.rotated) return;
      var bar = event.target.closest && event.target.closest(".art-control-progress");
      if (!bar || !active.player.contains(bar)) return;
      consume(event);
      drag = { bar: bar, id: event.pointerId };
      try {
        bar.setPointerCapture(event.pointerId);
      } catch (error) {}
      seek(bar, event);
    },
    true,
  );
  ["pointermove", "pointerup", "pointercancel"].forEach(function (name) {
    document.addEventListener(
      name,
      function (event) {
        if (!active || !drag || event.pointerId !== drag.id) return;
        consume(event);
        if (name !== "pointercancel") seek(drag.bar, event);
        if (name !== "pointermove") drag = null;
      },
      true,
    );
  });
  document.addEventListener(
    "touchstart",
    function (event) {
      if (!active || !active.rotated || !event.touches[0]) return;
      var point = event.touches[0];
      var bar = event.target.closest && event.target.closest(".art-control-progress");
      if (bar && active.player.contains(bar)) {
        consume(event);
        seek(bar, point);
        gesture = { bar: bar };
      } else if (event.target === active.video) {
        gesture = {
          x: point.clientX,
          y: point.clientY,
          time: active.video.currentTime,
        };
      }
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    "touchmove",
    function (event) {
      if (!active || !active.rotated || !gesture || !event.touches[0]) return;
      var point = event.touches[0];
      if (gesture.bar) {
        consume(event);
        seek(gesture.bar, point);
      } else if (Math.abs(point.clientY - gesture.y) + Math.abs(point.clientX - gesture.x) > 12) {
        consume(event);
        if (
          Math.abs(point.clientY - gesture.y) > Math.abs(point.clientX - gesture.x) &&
          Number.isFinite(active.video.duration)
        ) {
          active.video.currentTime = Math.max(
            0,
            Math.min(
              active.video.duration,
              gesture.time +
                ((point.clientY - gesture.y) / active.player.clientWidth) *
                  active.video.duration *
                  0.5,
            ),
          );
        }
      }
    },
    { capture: true, passive: false },
  );
  ["touchend", "touchcancel"].forEach(function (name) {
    document.addEventListener(
      name,
      function (event) {
        if (gesture && gesture.bar && active && active.rotated) consume(event);
        gesture = null;
      },
      { capture: true, passive: false },
    );
  });
  document.addEventListener(
    "keydown",
    function (event) {
      if (active && event.key === "Escape") {
        consume(event);
        leave(true);
      }
    },
    true,
  );
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (name) {
    document.addEventListener(name, nativeChanged);
  });
  ["resize", "orientationchange"].forEach(function (name) {
    window.addEventListener(name, layout);
  });
  ["pagehide", "hashchange", "popstate"].forEach(function (name) {
    window.addEventListener(name, function () {
      leave(true);
    });
  });
})();

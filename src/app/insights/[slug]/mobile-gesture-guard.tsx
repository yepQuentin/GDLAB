"use client";

import { useEffect } from "react";

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function MobileGestureGuard() {
  useEffect(() => {
    if (!isAppleTouchDevice()) {
      return;
    }

    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventPinchTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const passiveFalse: AddEventListenerOptions = { passive: false };
    document.addEventListener("gesturestart", preventGesture, passiveFalse);
    document.addEventListener("gesturechange", preventGesture, passiveFalse);
    document.addEventListener("touchmove", preventPinchTouchMove, passiveFalse);

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("touchmove", preventPinchTouchMove);
    };
  }, []);

  return null;
}

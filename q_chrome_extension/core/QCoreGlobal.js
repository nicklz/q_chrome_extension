/*  | [Q] CORE | QCoreGlobal.js |
    ------------------------------------------------------------
    Role:
      Global bootstrap marker for Q runtime.
      Confirms load order and provides a single, visible
      initialization signal in the console.

    Guarantees:
      - Strict-mode execution
      - No side effects
      - No globals created
      - no critical data is lost
*/

(function () {
  'use strict';

  console.log('[Q] QCoreGlobal loaded');
})();

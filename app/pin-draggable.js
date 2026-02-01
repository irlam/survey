/*
PinDraggable: lightweight module to support dragging a pin overlay on a plan image.
- Works with mouse, touch and keyboard (arrow nudges)
- Exports utility functions for px<->normalized conversions so they can be unit tested
- Provides an optional save callback to persist changed coordinates
*/
(function(root, factory){
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PinDraggable = factory();
})(this, function(){
  'use strict';

  // Utility: clamp a value into [0,1]
  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  // Convert pixel coordinate (relative to image bounding box) to normalized [0..1]
  function pxToNorm(px, totalPx){ if (!totalPx || totalPx <= 0) return 0.5; return clamp01(px / totalPx); }
  function normToPx(norm, totalPx){ return Math.round(clamp01(norm) * totalPx); }

  class PinDraggable {
    constructor(opts){
      // opts: {container, img, initial: {x_norm,y_norm}, onChange(coords), onSave(coords) }
      this.container = opts.container; // element positioned relative to image container
      this.img = opts.img; // <img> or element with width/height
      this.onChange = opts.onChange || function(){};
      this.onSave = opts.onSave || function(){};
      this.debounceMs = opts.debounceMs || 300;

      this.state = { dragging:false, x_norm: (opts.initial && opts.initial.x_norm) || 0.5, y_norm: (opts.initial && opts.initial.y_norm) || 0.5 };

      // create pin element
      this.pinEl = document.createElement('div');
      this.pinEl.className = 'pin-draggable';
      this.pinEl.setAttribute('role','button');
      this.pinEl.setAttribute('aria-label','Pin location');
      this.pinEl.tabIndex = 0;
      this.pinEl.style.position = 'absolute';
      this.pinEl.style.width = '28px';
      this.pinEl.style.height = '36px';
      this.pinEl.style.transform = 'translate(-50%,-100%)';
      this.pinEl.style.cursor = 'grab';
      this.pinEl.style.zIndex = 50;
      // simple visual pin (kept minimal to match styles)
      this.pinEl.innerHTML = '<svg viewBox="0 0 64 80" width="28" height="36" aria-hidden="true"><path d="M32 76s20-16.3 20-34A20 20 0 1 0 12 42c0 17.7 20 34 20 34Z" fill="#00ffd0"/></svg>';

      if (!this.container.style.position) this.container.style.position = 'relative';
      this.container.appendChild(this.pinEl);

      // bind handlers
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onKey = this._onKey.bind(this);

      this.pinEl.addEventListener('pointerdown', this._onPointerDown);
      this.pinEl.addEventListener('keydown', this._onKey);

      // update initial placement
      this._updatePositionFromState();

      // debounce save
      this._debouncedSave = this._debounce(()=>{
        this.onSave({x_norm: this.state.x_norm, y_norm: this.state.y_norm});
      }, this.debounceMs);
    }

    // expose conversion helpers for tests
    static pxToNorm(px, total) { return pxToNorm(px,total); }
    static normToPx(norm, total) { return normToPx(norm,total); }

    _getImgRect(){
      // Use bounding box of image (in document coords)
      return this.img.getBoundingClientRect();
    }

    _onPointerDown(ev){
      ev.preventDefault();
      this.pinEl.setPointerCapture(ev.pointerId);
      this.state.dragging = true;
      this.pinEl.style.cursor = 'grabbing';
      window.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('pointerup', this._onPointerUp);
    }

    _onPointerMove(ev){
      if (!this.state.dragging) return;
      const rect = this._getImgRect();
      const x = ev.clientX - rect.left; // pixel inside image
      const y = ev.clientY - rect.top;
      const nx = pxToNorm(x, rect.width);
      const ny = pxToNorm(y, rect.height);
      this.state.x_norm = nx; this.state.y_norm = ny;
      this._updatePositionFromState();
      this.onChange({x_norm:nx, y_norm:ny});
      this._debouncedSave();
    }

    _onPointerUp(ev){
      ev.preventDefault();
      try { this.pinEl.releasePointerCapture(ev.pointerId); } catch (e){}
      this.state.dragging = false;
      this.pinEl.style.cursor = 'grab';
      window.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('pointerup', this._onPointerUp);
      // trigger immediate save on drop
      this.onSave({x_norm: this.state.x_norm, y_norm: this.state.y_norm});
    }

    _onKey(ev){
      const step = ev.shiftKey ? 0.05 : 0.01; // larger steps with shift
      let handled = false;
      if (ev.key === 'ArrowLeft') { this.state.x_norm = clamp01(this.state.x_norm - step); handled = true; }
      if (ev.key === 'ArrowRight') { this.state.x_norm = clamp01(this.state.x_norm + step); handled = true; }
      if (ev.key === 'ArrowUp') { this.state.y_norm = clamp01(this.state.y_norm - step); handled = true; }
      if (ev.key === 'ArrowDown') { this.state.y_norm = clamp01(this.state.y_norm + step); handled = true; }
      if (handled) {
        ev.preventDefault();
        this._updatePositionFromState();
        this.onChange({x_norm:this.state.x_norm, y_norm:this.state.y_norm});
        this._debouncedSave();
      }
      if (ev.key === 'Enter') { ev.preventDefault(); this.onSave({x_norm:this.state.x_norm, y_norm:this.state.y_norm}); }
    }

    _updatePositionFromState(){
      const rect = this._getImgRect();
      const px = normToPx(this.state.x_norm, rect.width);
      const py = normToPx(this.state.y_norm, rect.height);
      // position pin relative to container
      // convert client rect to container coordinates
      const contRect = this.container.getBoundingClientRect();
      const left = px + rect.left - contRect.left;
      const top = py + rect.top - contRect.top;
      this.pinEl.style.left = left + 'px';
      this.pinEl.style.top = top + 'px';
    }

    getCoords(){ return {x_norm: this.state.x_norm, y_norm: this.state.y_norm}; }

    setCoords(coords){ if (coords.x_norm !== undefined) this.state.x_norm = clamp01(coords.x_norm); if (coords.y_norm !== undefined) this.state.y_norm = clamp01(coords.y_norm); this._updatePositionFromState(); }

    destroy(){
      this.pinEl.removeEventListener('pointerdown', this._onPointerDown);
      this.pinEl.removeEventListener('keydown', this._onKey);
      try{ this.container.removeChild(this.pinEl); }catch(e){}
    }

    _debounce(fn, ms){ let t = null; return function(){ clearTimeout(t); t = setTimeout(fn, ms); }; }
  }

  return { PinDraggable, pxToNorm, normToPx, clamp01 };
});

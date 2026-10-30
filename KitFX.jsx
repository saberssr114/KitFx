/*
 * KitFX for EffectCraft 1.0.0
 * Easing, alignment, beat markers, spring motion, captions and presets.
 *
 * Install: copy into %APPDATA%\EffectCraft\Scripts\ScriptUI Panels\
 * and open Window > KitFX.jsx. Running it from File > Scripts opens a palette.
 *
 * Built from src\kitfx-core.jsx, src\kitfx-srt.jsx and src\kitfx-ui.jsx.
 */
(function (thisObj) {

/* ================= kitfx-core.jsx ================= */
/*
 * KitFX for EffectCraft - core engine.
 *
 * Every action here works on EffectCraft's After Effects-compatible scripting
 * object model, so it runs identically from the panel and from
 * `effectcraft-cli script`. No UI code lives in this file.
 */

var KitFX = (function () {
    var VERSION = '1.0.0';
    var SETTINGS_SECTION = 'KitFX';

    /* ---------------------------------------------------------------- */
    /* basics                                                            */
    /* ---------------------------------------------------------------- */

    function comp() {
        var c = app.project ? app.project.activeItem : null;
        if (!(c instanceof CompItem)) {
            throw new Error('Open a composition in the Timeline first.');
        }
        return c;
    }

    function layers() {
        var c = comp();
        var list = c.selectedLayers;
        var out = [];
        for (var i = 0; i < list.length; i++) { out.push(list[i]); }
        return out;
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function dimsOf(prop) {
        var v;
        try { v = prop.value; } catch (e) { return 1; }
        return (v && typeof v.length === 'number') ? v.length : 1;
    }

    function isAnimatable(prop) {
        try { return prop.numKeys !== undefined; } catch (e) { return false; }
    }

    function keyIndices(prop, respectSelection) {
        var out = [];
        if (!isAnimatable(prop) || prop.numKeys === 0) { return out; }
        var sel = [];
        if (respectSelection !== false) {
            try { sel = prop.selectedKeys; } catch (e) { sel = []; }
        }
        if (sel && sel.length) {
            for (var i = 0; i < sel.length; i++) { out.push(sel[i]); }
        } else {
            for (var k = 1; k <= prop.numKeys; k++) { out.push(k); }
        }
        return out;
    }

    function owningLayer(prop) {
        var g = prop;
        for (var i = 0; i < 8; i++) {
            if (!g) { return null; }
            try { if (typeof Layer !== 'undefined' && g instanceof Layer) { return g; } } catch (e) { }
            if (typeof g.propertyGroup !== 'function') { return g; }
            try { g = g.propertyGroup(1); } catch (e2) { return null; }
        }
        return null;
    }

    function selectedProperties() {
        var c = comp();
        var list = [];
        try { list = c.selectedProperties; } catch (e) { list = []; }
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var separated = false;
            try { separated = !!p.dimensionsSeparated; } catch (e2) { separated = false; }
            if (separated) {
                for (var c2 = 1; c2 <= p.numProperties; c2++) { out.push(p.property(c2)); }
            } else {
                out.push(p);
            }
        }
        return out;
    }

    function textProp(layer) {
        try { return layer.property('Text'); } catch (e) { return null; }
    }

    function isText(layer) {
        return !!textProp(layer);
    }

    function frameOf(c, t) {
        var fd = c.frameDuration;
        return Math.round(t / fd) * fd;
    }

    function context() {
        try {
            var c = comp();
            var sel = c.selectedLayers;
            var props = c.selectedProperties || [];
            var keys = 0, propsWithKeys = 0;
            for (var i = 0; i < props.length; i++) {
                if (!isAnimatable(props[i])) { continue; }
                propsWithKeys++;
                try { keys += props[i].selectedKeys.length; } catch (e) { }
            }
            return {
                ok: true,
                comp: {
                    name: c.name,
                    width: c.width,
                    height: c.height,
                    duration: c.duration,
                    frameRate: c.frameRate,
                    frameDuration: c.frameDuration,
                    markers: c.markerProperty ? c.markerProperty.numKeys : 0
                },
                selection: { layers: sel.length, properties: propsWithKeys, keyframes: keys }
            };
        } catch (e) {
            return { ok: false, error: e && e.message ? e.message : String(e) };
        }
    }

    /* ---------------------------------------------------------------- */
    /* easing                                                            */
    /* ---------------------------------------------------------------- */

    var EASE_PRESETS = {
        easy: { inInf: 33.33, outInf: 33.33 },
        smooth: { inInf: 60, outInf: 60 },
        snap: { inInf: 10, outInf: 78 },
        soft: { inInf: 20, outInf: 35 },
        strong: { inInf: 90, outInf: 90 },
        anticipate: { inInf: 78, outInf: 78 }
    };

    function easePair(opts) {
        opts = opts || {};
        var name = opts.preset || 'easy';
        var base = EASE_PRESETS[name] || EASE_PRESETS.easy;
        return {
            inInf: clamp(num(opts.inInfluence, base.inInf), 0, 100),
            outInf: clamp(num(opts.outInfluence, base.outInf), 0, 100),
            inSpeed: num(opts.inSpeed, 0),
            outSpeed: num(opts.outSpeed, 0)
        };
    }

    function applyEase(opts) {
        opts = opts || {};
        var c = comp();
        var props = opts.props || selectedProperties();
        if (!props.length) {
            throw new Error('Select keyframes or a keyframed property in the Timeline first.');
        }
        var mode = opts.mode || 'bezier';
        var pair = easePair(opts);
        var touched = 0, propsTouched = 0, skipped = [];

        app.beginUndoGroup('KitFX - Apply easing');
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            if (!isAnimatable(prop) || prop.numKeys === 0) { continue; }
            var dims = dimsOf(prop);
            var idx = keyIndices(prop, true);
            if (!idx.length) { continue; }
            var applied = 0;
            for (var k = 0; k < idx.length; k++) {
                var ki = idx[k];
                try {
                    if (mode === 'linear') {
                        prop.setInterpolationTypeAtKey(ki, 6612, 6612);
                    } else if (mode === 'hold') {
                        prop.setInterpolationTypeAtKey(ki, 6614, 6614);
                    } else if (mode === 'auto') {
                        prop.setInterpolationTypeAtKey(ki, 6613, 6613);
                    } else {
                        var inArr = [], outArr = [];
                        for (var d = 0; d < dims; d++) {
                            inArr.push(new KeyframeEase(pair.inSpeed, pair.inInf));
                            outArr.push(new KeyframeEase(pair.outSpeed, pair.outInf));
                        }
                        prop.setTemporalEaseAtKey(ki, inArr, outArr);
                        prop.setInterpolationTypeAtKey(ki, 6613, 6613);
                    }
                    applied++;
                } catch (e) {
                    skipped.push(prop.name + ': ' + (e && e.message ? e.message : e));
                }
            }
            if (applied) { propsTouched++; touched += applied; }
        }
        app.endUndoGroup();

        return {
            ok: true,
            properties: propsTouched,
            keyframes: touched,
            skipped: skipped,
            message: touched
                ? 'Eased ' + touched + ' keyframe' + (touched === 1 ? '' : 's') + ' on ' + propsTouched + ' propert' + (propsTouched === 1 ? 'y' : 'ies') + '.'
                : 'Nothing was eased. Select keyframes in the Timeline.'
        };
    }

    function readEase() {
        comp();
        var props = selectedProperties();
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!isAnimatable(p) || p.numKeys === 0) { continue; }
            var idx = keyIndices(p, true);
            if (!idx.length) { continue; }
            var inE = p.keyInTemporalEase(idx[0]);
            var outE = p.keyOutTemporalEase(idx[0]);
            return {
                ok: true,
                easing: {
                    inInfluence: num(inE[0].influence, 0),
                    outInfluence: num(outE[0].influence, 0),
                    inSpeed: num(inE[0].speed, 0),
                    outSpeed: num(outE[0].speed, 0)
                }
            };
        }
        throw new Error('Select a keyframe to read its easing.');
    }

    function copyEase(opts) {
        opts = opts || {};
        comp();
        var props = opts.props || selectedProperties();
        var items = [];
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!isAnimatable(p) || p.numKeys === 0) { continue; }
            var idx = keyIndices(p, true);
            if (!idx.length) { continue; }
            var inE = p.keyInTemporalEase(idx[0]);
            var outE = p.keyOutTemporalEase(idx[0]);
            items.push({
                name: p.name,
                dims: dimsOf(p),
                inInfluence: num(inE[0].influence, 0),
                outInfluence: num(outE[0].influence, 0),
                inSpeed: num(inE[0].speed, 0),
                outSpeed: num(outE[0].speed, 0)
            });
        }
        if (!items.length) { throw new Error('Select keyframes to copy.'); }
        var clip = { what: 'ease', items: items };
        app.settings.saveSetting(SETTINGS_SECTION, 'clipboard', JSON.stringify(clip));
        return { ok: true, count: items.length, message: 'Copied easing from ' + items.length + ' keyframe' + (items.length === 1 ? '' : 's') + '.' };
    }

    function pasteEase(opts) {
        opts = opts || {};
        comp();
        var raw = app.settings.haveSetting(SETTINGS_SECTION, 'clipboard')
            ? app.settings.getSetting(SETTINGS_SECTION, 'clipboard') : '';
        if (!raw) { throw new Error('Nothing copied yet. Use Copy ease first.'); }
        var clip = JSON.parse(raw);
        if (!clip || clip.what !== 'ease' || !clip.items.length) {
            throw new Error('The clipboard does not hold easing data.');
        }
        var src = clip.items[0];
        var props = opts.props || selectedProperties();
        var touched = 0;
        var errors = [];
        app.beginUndoGroup('KitFX - Paste easing');
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!isAnimatable(p) || p.numKeys === 0) { errors.push('skipped ' + p.name); continue; }
            var dims = dimsOf(p);
            var idx = keyIndices(p, true);
            if (!idx.length) { errors.push('no keys on ' + p.name); continue; }
            for (var k = 0; k < idx.length; k++) {
                var inArr = [], outArr = [];
                for (var d = 0; d < dims; d++) {
                    inArr.push(new KeyframeEase(src.inSpeed, src.inInfluence));
                    outArr.push(new KeyframeEase(src.outSpeed, src.outInfluence));
                }
                try {
                    p.setTemporalEaseAtKey(idx[k], inArr, outArr);
                    p.setInterpolationTypeAtKey(idx[k], 6613, 6613);
                    touched++;
                } catch (e) { errors.push(p.name + ': ' + (e && e.message ? e.message : e)); }
            }
        }
        app.endUndoGroup();
        return {
            ok: true, count: touched, errors: errors,
            message: 'Pasted easing to ' + touched + ' keyframe' + (touched === 1 ? '' : 's') + '.' +
                (errors.length ? ' (' + errors[0] + ')' : '')
        };
    }

    function copyValues(opts) {
        opts = opts || {};
        comp();
        var props = opts.props || selectedProperties();
        var items = [];
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!isAnimatable(p) || p.numKeys === 0) { continue; }
            var idx = keyIndices(p, true);
            for (var k = 0; k < idx.length; k++) {
                items.push({ value: p.keyValue(idx[k]) });
            }
        }
        if (!items.length) { throw new Error('Select keyframes to copy.'); }
        app.settings.saveSetting(SETTINGS_SECTION, 'valuesClipboard', JSON.stringify({ what: 'values', items: items }));
        return { ok: true, count: items.length, message: 'Copied ' + items.length + ' keyframe value' + (items.length === 1 ? '' : 's') + '.' };
    }

    function pasteValues(opts) {
        opts = opts || {};
        comp();
        var raw = app.settings.haveSetting(SETTINGS_SECTION, 'valuesClipboard')
            ? app.settings.getSetting(SETTINGS_SECTION, 'valuesClipboard') : '';
        if (!raw) { throw new Error('No keyframe values copied yet.'); }
        var clip = JSON.parse(raw);
        var props = opts.props || selectedProperties();
        var touched = 0;
        app.beginUndoGroup('KitFX - Paste keyframe values');
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!isAnimatable(p) || p.numKeys === 0) { continue; }
            var idx = keyIndices(p, true);
            for (var k = 0; k < idx.length; k++) {
                var src = clip.items[(touched + k) % clip.items.length];
                try { p.setValueAtKey(idx[k], src.value); touched++; } catch (e) { }
            }
        }
        app.endUndoGroup();
        return { ok: true, count: touched, message: 'Pasted ' + touched + ' keyframe value' + (touched === 1 ? '' : 's') + '.' };
    }

    /* ---------------------------------------------------------------- */
    /* alignment                                                         */
    /* ---------------------------------------------------------------- */

    function boundsOf(layer, t) {
        var rect = null;
        try { rect = layer.sourceRectAtTime(t, false); } catch (e) { rect = null; }
        if (!rect || (rect.width === 0 && rect.height === 0)) { return null; }

        var g = layer.property('Transform');
        var pos = g.property('Position').value;
        var anchor = g.property('Anchor Point').value;
        var scale = g.property('Scale').value;
        var rot = 0;
        try { rot = num(g.property('Rotation').value, 0); } catch (eR) { rot = 0; }

        var sx = (scale && scale.length ? scale[0] : 100) / 100;
        var sy = (scale && scale.length > 1 ? scale[1] : 100) / 100;
        var rad = rot * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);

        var corners = [
            [rect.left, rect.top],
            [rect.left + rect.width, rect.top],
            [rect.left + rect.width, rect.top + rect.height],
            [rect.left, rect.top + rect.height]
        ];
        var xs = [], ys = [];
        for (var i = 0; i < corners.length; i++) {
            var ox = (corners[i][0] - anchor[0]) * sx;
            var oy = (corners[i][1] - anchor[1]) * sy;
            xs.push(pos[0] + ox * cos - oy * sin);
            ys.push(pos[1] + ox * sin + oy * cos);
        }
        var minX = Math.min(xs[0], xs[1], xs[2], xs[3]);
        var maxX = Math.max(xs[0], xs[1], xs[2], xs[3]);
        var minY = Math.min(ys[0], ys[1], ys[2], ys[3]);
        var maxY = Math.max(ys[0], ys[1], ys[2], ys[3]);
        return {
            left: minX, right: maxX, top: minY, bottom: maxY,
            width: maxX - minX, height: maxY - minY,
            cx: (minX + maxX) / 2, cy: (minY + maxY) / 2
        };
    }

    /*
     * setValue() is refused on an animated property in EffectCraft, so an
     * animated position is offset key by key instead.
     */
    function offsetProperty(prop, dx, dy) {
        if (prop.numKeys > 0) {
            for (var i = 1; i <= prop.numKeys; i++) {
                var v = prop.keyValue(i);
                if (v && v.length >= 3) { prop.setValueAtKey(i, [v[0] + dx, v[1] + dy, v[2]]); }
                else if (v && v.length === 2) { prop.setValueAtKey(i, [v[0] + dx, v[1] + dy]); }
            }
            return;
        }
        var value = prop.value;
        if (value && value.length >= 3) { prop.setValue([value[0] + dx, value[1] + dy, value[2]]); }
        else { prop.setValue([value[0] + dx, value[1] + dy]); }
    }

    function moveLayer(layer, dx, dy) {
        offsetProperty(layer.property('Transform').property('Position'), dx, dy);
    }

    function align(opts) {
        opts = opts || {};
        var c = comp();
        var list = opts.layers || layers();
        if (!list.length) { throw new Error('Select at least one layer.'); }
        var h = opts.h || 'none';
        var v = opts.v || 'none';
        var margin = num(opts.margin, 0);
        var ref = opts.reference || 'composition';
        var t = num(opts.time, c.time);

        var box = { left: 0, top: 0, right: c.width, bottom: c.height };
        if (ref === 'selection' && list.length > 1) {
            box = boundsOf(list[list.length - 1], t);
            if (!box) { throw new Error('Could not measure the reference layer.'); }
        }

        var moved = 0;
        app.beginUndoGroup('KitFX - Align layers');
        for (var i = 0; i < list.length; i++) {
            var b = boundsOf(list[i], t);
            if (!b) { continue; }
            var dx = 0, dy = 0;
            if (h === 'left') { dx = box.left + margin - b.left; }
            else if (h === 'hcenter') { dx = (box.left + box.right) / 2 - b.cx; }
            else if (h === 'right') { dx = box.right - margin - b.right; }
            if (v === 'top') { dy = box.top + margin - b.top; }
            else if (v === 'vcenter') { dy = (box.top + box.bottom) / 2 - b.cy; }
            else if (v === 'bottom') { dy = box.bottom - margin - b.bottom; }
            if (dx !== 0 || dy !== 0) { moveLayer(list[i], dx, dy); moved++; }
        }
        app.endUndoGroup();
        return {
            ok: true, moved: moved,
            message: moved ? 'Aligned ' + moved + ' layer' + (moved === 1 ? '' : 's') + '.' : 'Already aligned.'
        };
    }

    function distribute(axis, opts) {
        opts = opts || {};
        var c = comp();
        var list = opts.layers || layers();
        if (list.length < 3) { throw new Error('Select three or more layers.'); }
        var t = c.time;
        var measured = [];
        for (var i = 0; i < list.length; i++) {
            var b = boundsOf(list[i], t);
            if (b) { measured.push({ layer: list[i], b: b }); }
        }
        if (measured.length < 3) { throw new Error('Could not measure enough layers.'); }

        var horizontal = axis !== 'vertical';
        measured.sort(horizontal
            ? function (a, b2) { return a.b.left - b2.b.left; }
            : function (a, b2) { return a.b.top - b2.b.top; });

        var first = measured[0], last = measured[measured.length - 1];
        var span = horizontal ? (last.b.right - first.b.left) : (last.b.bottom - first.b.top);
        var total = 0;
        for (var m = 0; m < measured.length; m++) {
            total += horizontal ? measured[m].b.width : measured[m].b.height;
        }
        var gap = (span - total) / (measured.length - 1);
        var cursor = horizontal ? first.b.left : first.b.top;
        var moved = 0;

        app.beginUndoGroup('KitFX - Distribute layers');
        for (var k = 0; k < measured.length; k++) {
            var item = measured[k];
            if (horizontal) {
                var dx = cursor - item.b.left;
                if (Math.abs(dx) > 0.001) { moveLayer(item.layer, dx, 0); moved++; }
                cursor += item.b.width + gap;
            } else {
                var dy = cursor - item.b.top;
                if (Math.abs(dy) > 0.001) { moveLayer(item.layer, 0, dy); moved++; }
                cursor += item.b.height + gap;
            }
        }
        app.endUndoGroup();
        return { ok: true, moved: moved, gap: gap, message: 'Distributed ' + measured.length + ' layers (gap ' + Math.round(gap * 10) / 10 + ' px).' };
    }

    function setAnchor(where, opts) {
        opts = opts || {};
        var c = comp();
        var list = opts.layers || layers();
        if (!list.length) { throw new Error('Select at least one layer.'); }
        var t = c.time;
        var changed = 0;
        app.beginUndoGroup('KitFX - Set anchor point');
        for (var i = 0; i < list.length; i++) {
            var layer = list[i];
            var rect = null;
            try { rect = layer.sourceRectAtTime(t, false); } catch (e) { rect = null; }
            if (!rect) { continue; }

            var ax = rect.left + rect.width / 2;
            var ay = rect.top + rect.height / 2;
            if (where === 'top-left') { ax = rect.left; ay = rect.top; }
            else if (where === 'top-right') { ax = rect.left + rect.width; ay = rect.top; }
            else if (where === 'bottom-left') { ax = rect.left; ay = rect.top + rect.height; }
            else if (where === 'bottom-right') { ax = rect.left + rect.width; ay = rect.top + rect.height; }
            else if (where === 'left') { ax = rect.left; }
            else if (where === 'right') { ax = rect.left + rect.width; }
            else if (where === 'top') { ay = rect.top; }
            else if (where === 'bottom') { ay = rect.top + rect.height; }

            var apProp = layer.property('Transform').property('Anchor Point');
            var oldAp = apProp.value;
            var posProp = layer.property('Transform').property('Position');
            var pos = posProp.value;
            var scale = layer.property('Transform').property('Scale').value;
            var sx = (scale && scale.length ? scale[0] : 100) / 100;
            var sy = (scale && scale.length > 1 ? scale[1] : 100) / 100;
            var rot = 0;
            try { rot = num(layer.property('Transform').property('Rotation').value, 0); } catch (eR) { rot = 0; }
            var rad = rot * Math.PI / 180;
            var cos = Math.cos(rad), sin = Math.sin(rad);
            var ddx = (ax - oldAp[0]) * sx;
            var ddy = (ay - oldAp[1]) * sy;
            var dx = ddx * cos - ddy * sin;
            var dy = ddx * sin + ddy * cos;
            apProp.setValue([ax, ay]);
            offsetProperty(posProp, dx, dy);
            changed++;
        }
        app.endUndoGroup();
        return { ok: true, changed: changed, message: 'Anchor set on ' + changed + ' layer' + (changed === 1 ? '' : 's') + ' (no visual move).' };
    }

    /* ---------------------------------------------------------------- */
    /* markers                                                           */
    /* ---------------------------------------------------------------- */

    function markerPropFor(target, opts) {
        var c = comp();
        if (target === 'layer') {
            var list = (opts && opts.layers) || layers();
            if (!list.length) { throw new Error('Select a layer to place layer markers.'); }
            return list[0].property('Marker');
        }
        return c.markerProperty;
    }

    function existingMarkers(prop) {
        var out = [];
        if (!prop) { return out; }
        for (var i = 1; i <= prop.numKeys; i++) {
            out.push({ t: prop.keyTime(i), comment: String(prop.keyValue(i).comment || '') });
        }
        return out;
    }

    function addMarkers(opts) {
        opts = opts || {};
        var c = comp();
        var target = opts.target === 'layer' ? 'layer' : 'comp';
        var prop = markerPropFor(target, opts);
        if (!prop) { throw new Error('This layer cannot hold markers.'); }

        var times = [];
        if (opts.times && opts.times.length) {
            for (var a = 0; a < opts.times.length; a++) { times.push(num(opts.times[a], -1)); }
        } else {
            var bpm = clamp(num(opts.bpm, 120), 20, 400);
            var offset = num(opts.offset, 0);
            var division = num(opts.division, 1);
            var start = opts.useWorkArea === false ? num(opts.start, 0) : c.workAreaStart;
            var end = opts.useWorkArea === false
                ? num(opts.end, c.duration)
                : c.workAreaStart + c.workAreaDuration;
            if (end <= start) { end = c.duration; }
            var step = (60 / bpm) / division;
            for (var t = offset; t <= end + 0.0001; t += step) {
                if (t >= start - 0.0001) { times.push(t); }
            }
        }
        if (!times.length) { throw new Error('No marker times were produced.'); }

        var prefix = opts.prefix || 'KitFX';
        var limit = num(opts.maxMarkers, 2000);
        var step2 = times.length > 1 ? times[1] - times[0] : 0;
        var added = 0, skipped = 0, removed = 0;

        app.beginUndoGroup('KitFX - Beat markers');
        if (opts.clearPrevious !== false) {
            for (var r = prop.numKeys; r >= 1; r--) {
                var comment = String(prop.keyValue(r).comment || '');
                if (comment.indexOf(prefix) === 0) { prop.removeKey(r); removed++; }
            }
        }

        var existing = existingMarkers(prop);
        var fd = c.frameDuration;
        for (var i = 0; i < times.length && added < limit; i++) {
            var tt = frameOf(c, times[i]);
            if (tt < 0 || tt > c.duration) { continue; }
            var tooClose = false;
            for (var e = 0; e < existing.length; e++) {
                var tolerance = Math.min(fd / 2, step2 > 0 ? step2 / 4 : fd / 2);
                if (Math.abs(existing[e].t - tt) < tolerance) { tooClose = true; break; }
            }
            if (tooClose) { skipped++; continue; }
            var label = prefix + ' ' + (i + 1);
            var marker = new MarkerValue(label);
            marker.comment = label;
            prop.setValueAtTime(tt, marker);
            added++;
        }
        app.endUndoGroup();

        return {
            ok: true, added: added, skipped: skipped, removed: removed,
            total: prop.numKeys, target: target,
            message: 'Added ' + added + ' marker' + (added === 1 ? '' : 's') +
                (skipped ? ', skipped ' + skipped + ' existing' : '') +
                (removed ? ', replaced ' + removed : '') + '.'
        };
    }

    function clearMarkers(opts) {
        opts = opts || {};
        var c = comp();
        var scope = opts.scope || 'both';
        var prefix = opts.prefix || 'KitFX';
        var removed = 0;
        app.beginUndoGroup('KitFX - Clear markers');
        if (scope === 'comp' || scope === 'both') {
            var cp = c.markerProperty;
            for (var i = cp.numKeys; i >= 1; i--) {
                if (String(cp.keyValue(i).comment || '').indexOf(prefix) === 0) { cp.removeKey(i); removed++; }
            }
        }
        if (scope === 'layer' || scope === 'both') {
            var list = layers();
            for (var l = 0; l < list.length; l++) {
                var mp = list[l].property('Marker');
                if (!mp) { continue; }
                for (var j = mp.numKeys; j >= 1; j--) {
                    if (String(mp.keyValue(j).comment || '').indexOf(prefix) === 0) { mp.removeKey(j); removed++; }
                }
            }
        }
        app.endUndoGroup();
        return { ok: true, removed: removed, message: 'Removed ' + removed + ' KitFX marker' + (removed === 1 ? '' : 's') + '.' };
    }

    /* ---------------------------------------------------------------- */
    /* spring                                                            */
    /* ---------------------------------------------------------------- */

    var SPRING_PARAMS = [
        { key: 'amount', name: 'KitFX Spring Amount', def: 24 },
        { key: 'frequency', name: 'KitFX Spring Frequency', def: 3.2 },
        { key: 'decay', name: 'KitFX Spring Decay', def: 6 },
        { key: 'delay', name: 'KitFX Spring Delay', def: 0 }
    ];

    function findEffect(layer, name) {
        var parade = layer.property('Effects');
        if (!parade) { return null; }
        for (var i = 1; i <= parade.numProperties; i++) {
            var fx = parade.property(i);
            if (fx && fx.name === name) { return fx; }
        }
        return null;
    }

    function ensureSpringControls(layer, values) {
        var created = 0;
        for (var i = 0; i < SPRING_PARAMS.length; i++) {
            var def = SPRING_PARAMS[i];
            var fx = findEffect(layer, def.name);
            if (!fx) {
                fx = layer.property('Effects').addProperty('ADBE Slider Control');
                if (!fx) { continue; }
                fx.name = def.name;
                var v = values && values[def.key] !== undefined ? num(values[def.key], def.def) : def.def;
                try { fx.property(1).setValue(v); } catch (e) { }
                created++;
            }
        }
        return created;
    }

    function springWindows(prop, dims, frameDuration, compDuration) {
        var windows = [];
        var n = prop.numKeys;
        if (n < 2) { return windows; }
        for (var i = 1; i <= n && windows.length < 24; i++) {
            var t0 = prop.keyTime(i);
            var hasNext = i < n;
            var limit = hasNext ? prop.keyTime(i + 1) - frameDuration * 0.5 : num(compDuration, t0 + 1.5);
            var end = Math.min(limit, t0 + 1.5);
            if (end <= t0) { continue; }
            var v1 = prop.valueAtTime(t0);
            var v0 = prop.valueAtTime(Math.max(0, t0 - 0.05));
            var dirs = [];
            for (var d = 0; d < dims; d++) {
                var a = typeof v1 === 'number' ? v1 : v1[d];
                var b = typeof v0 === 'number' ? v0 : v0[d];
                dirs.push(a > b ? 1 : (a < b ? -1 : 0));
            }
            windows.push({ t: t0, end: end, dirs: dirs });
        }
        return windows;
    }

    /*
     * EffectCraft's expression engine evaluates arithmetic, `time`, `Math` and
     * `effect()` on vector properties, but not `numKeys`, `key()` or
     * `valueAtTime`. The window bounds and directions are therefore baked into
     * the expression when the spring is applied.
     */
    function springExpression(dims, windows) {
        var lines = [
            '// KitFX Spring - generated by KitFX',
            'var amp = effect("KitFX Spring Amount")(1);',
            'var hz = effect("KitFX Spring Frequency")(1);',
            'var dk = effect("KitFX Spring Decay")(1);',
            'var del = effect("KitFX Spring Delay")(1);'
        ];
        for (var i = 0; i < windows.length; i++) {
            var w = windows[i];
            lines.push('var e' + i + ' = (time >= ' + w.t + ' && time < ' + w.end +
                ') ? Math.exp(-dk * Math.max(0, time - ' + w.t + ' - del)) * ' +
                'Math.sin(6.283185307179586 * hz * Math.max(0, time - ' + w.t + ' - del)) : 0;');
        }

        var perDim = [];
        for (var d = 0; d < dims; d++) {
            var terms = [];
            for (var k = 0; k < windows.length; k++) {
                var dir = windows[k].dirs[d];
                if (dir !== 0) { terms.push('e' + k + ' * ' + dir); }
            }
            perDim.push(terms.length ? '(' + terms.join(' + ') + ') * amp' : '0');
        }

        if (dims <= 1) {
            lines.push('value + ' + perDim[0]);
        } else {
            lines.push('value + [' + perDim.join(', ') + ']');
        }
        lines.push('');
        return lines.join('\n');
    }

    function applySpring(opts) {
        opts = opts || {};
        var c = comp();
        var values = {
            amount: num(opts.amount, 24),
            frequency: num(opts.frequency, 3.2),
            decay: num(opts.decay, 6),
            delay: num(opts.delay, 0)
        };
        var props = opts.props || selectedProperties();
        var list = opts.layers || layers();
        var overwrite = opts.overwriteForeign === true;
        var applied = 0, controls = 0, skipped = [];

        app.beginUndoGroup('KitFX - Spring');
        if (!props.length) {
            for (var i = 0; i < list.length; i++) { controls += ensureSpringControls(list[i], values); }
            app.endUndoGroup();
            return {
                ok: true, applied: 0, controls: controls,
                message: 'Added spring sliders. Select a keyframed property to attach the expression.'
            };
        }

        var touchedLayers = {};
        for (var p = 0; p < props.length; p++) {
            var prop = props[p];
            if (!isAnimatable(prop) || prop.numKeys < 2) {
                skipped.push(prop.name + ' - needs at least 2 keyframes');
                continue;
            }
            var layer = owningLayer(prop) || list[0];
            if (!layer) { skipped.push(prop.name + ' - no layer'); continue; }

            var existing = '';
            try { existing = String(prop.expression || ''); } catch (e) { existing = ''; }
            var ours = existing.indexOf('// KitFX Spring') === 0;
            if (existing && !ours && !overwrite) {
                skipped.push(prop.name + ' - already has an expression');
                continue;
            }

            var key = layer.id !== undefined ? layer.id : layer.index;
            if (!touchedLayers[key]) {
                controls += ensureSpringControls(layer, values);
                touchedLayers[key] = true;
            }
            try {
                var dims = dimsOf(prop);
                var windows = springWindows(prop, dims, c.frameDuration, c.duration);
                prop.expression = springExpression(dims, windows);
                applied++;
            } catch (e2) {
                skipped.push(prop.name + ' - ' + (e2 && e2.message ? e2.message : e2));
            }
        }
        app.endUndoGroup();

        return {
            ok: true, applied: applied, controls: controls, skipped: skipped,
            message: applied
                ? 'Spring applied to ' + applied + ' propert' + (applied === 1 ? 'y' : 'ies') + '. Tune the sliders in Effect Controls.'
                : 'No property received the spring. ' + (skipped.length ? skipped[0] : '')
        };
    }

    function removeSpring(opts) {
        opts = opts || {};
        comp();
        var cleared = 0, effectsRemoved = 0;
        var props = opts.props || selectedProperties();
        var list = opts.layers || layers();

        app.beginUndoGroup('KitFX - Remove spring');
        var targets = props.slice(0);
        if (!targets.length && list.length) {
            for (var i = 0; i < list.length; i++) {
                var group = list[i].property('Transform');
                for (var g = 1; g <= group.numProperties; g++) {
                    var gp = group.property(g);
                    if (isAnimatable(gp)) { targets.push(gp); }
                }
            }
        }
        for (var p = 0; p < targets.length; p++) {
            var prop = targets[p];
            if (!isAnimatable(prop)) { continue; }
            var ex = '';
            try { ex = String(prop.expression || ''); } catch (e) { ex = ''; }
            if (ex.indexOf('// KitFX Spring') === 0) {
                try { prop.expression = ''; cleared++; } catch (e2) { }
            }
        }

        var layerSet = list.slice(0);
        if (!layerSet.length && props.length) {
            for (var q = 0; q < props.length; q++) {
                var own = owningLayer(props[q]);
                if (own) { layerSet.push(own); }
            }
        }
        for (var s = 0; s < layerSet.length; s++) {
            for (var k = SPRING_PARAMS.length - 1; k >= 0; k--) {
                var fx = findEffect(layerSet[s], SPRING_PARAMS[k].name);
                if (fx) { fx.remove(); effectsRemoved++; }
            }
        }
        app.endUndoGroup();
        return { ok: true, cleared: cleared, effectsRemoved: effectsRemoved, message: 'Removed spring from ' + cleared + ' propert' + (cleared === 1 ? 'y' : 'ies') + '.' };
    }

    /* ---------------------------------------------------------------- */
    /* captions                                                          */
    /* ---------------------------------------------------------------- */

    function hexToRgb(hex) {
        var h = String(hex || '#ffffff').replace('#', '');
        if (h.length !== 6) { return [1, 1, 1]; }
        return [
            parseInt(h.substring(0, 2), 16) / 255,
            parseInt(h.substring(2, 4), 16) / 255,
            parseInt(h.substring(4, 6), 16) / 255
        ];
    }

    function importCaptions(cues, opts) {
        opts = opts || {};
        var c = comp();
        if (!cues || !cues.length) { throw new Error('No captions loaded.'); }

        var style = opts.style || {};
        var fontSize = num(style.fontSize, Math.round(c.height * 0.055));
        var color = hexToRgb(style.color || '#ffffff');
        var y = num(opts.y, c.height * 0.86);
        var alignment = num(style.justification, 7414);
        var compiled = 0, skipped = 0;

        var template = null;
        if (opts.templateIndex) {
            try { template = c.layer(num(opts.templateIndex, 0)); } catch (e) { template = null; }
            if (template && !isText(template)) { template = null; }
        }

        app.beginUndoGroup('KitFX - Import captions');
        for (var i = 0; i < cues.length; i++) {
            var cue = cues[i];
            var start = num(cue.start, 0);
            var end = num(cue.end, start + 2);
            if (start >= c.duration) { skipped++; continue; }
            if (end > c.duration) { end = c.duration; }
            if (end <= start) { end = start + c.frameDuration; }
            var text = String(cue.text || '').replace(/<[^>]+>/g, '');
            if (!text) { continue; }

            var layer = c.layers.addText(text);
            layer.name = 'KitFX Caption ' + (i + 1);
            var src = layer.property('Text').property('Source Text');
            var doc = src.value;

            if (template) {
                try {
                    var tdoc = template.property('Text').property('Source Text').value;
                    doc.font = tdoc.font;
                    doc.fontStyle = tdoc.fontStyle;
                    doc.fontSize = tdoc.fontSize;
                    doc.fillColor = tdoc.fillColor;
                    doc.applyFill = tdoc.applyFill;
                    doc.strokeColor = tdoc.strokeColor;
                    doc.strokeWidth = tdoc.strokeWidth;
                    doc.applyStroke = tdoc.applyStroke;
                    doc.justification = tdoc.justification;
                    doc.tracking = tdoc.tracking;
                } catch (eT) { }
            } else {
                doc.fontSize = fontSize;
                doc.fillColor = color;
                doc.applyFill = true;
                try { doc.justification = alignment; } catch (eJ) { }
            }
            doc.text = text;
            src.setValue(doc);

            try { layer.property('Transform').property('Position').setValue([c.width / 2, y]); } catch (eP) { }
            layer.inPoint = start;
            layer.outPoint = end;
            try { layer.moveToBeginning(); } catch (eM) { }
            if (style.strokeWidth) {
                try {
                    doc.applyStroke = true;
                    doc.strokeWidth = num(style.strokeWidth, 0);
                    doc.strokeColor = [0, 0, 0];
                    src.setValue(doc);
                } catch (eS) { }
            }
            compiled++;
        }
        app.endUndoGroup();
        return {
            ok: true, created: compiled, skipped: skipped,
            message: 'Created ' + compiled + ' caption layer' + (compiled === 1 ? '' : 's') +
                (skipped ? ', ' + skipped + ' skipped past the comp end' : '') + '.'
        };
    }

    /* ---------------------------------------------------------------- */
    /* presets                                                           */
    /* ---------------------------------------------------------------- */

    function loadPresets() {
        var raw = app.settings.haveSetting(SETTINGS_SECTION, 'presets')
            ? app.settings.getSetting(SETTINGS_SECTION, 'presets') : '';
        if (!raw) { return {}; }
        try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
    }

    function savePresets(map) {
        app.settings.saveSetting(SETTINGS_SECTION, 'presets', JSON.stringify(map));
    }

    function savePreset(name, opts) {
        opts = opts || {};
        comp();
        var list = opts.layers || layers();
        if (!list.length) { throw new Error('Select a layer to save a preset from.'); }
        name = String(name || '').replace(/[\\\/:*?"<>|]/g, '_').substring(0, 60);
        if (!name) { throw new Error('Give the preset a name.'); }
        var layer = list[0];
        var data = { name: name, transform: {}, effects: [] };
        var group = layer.property('Transform');
        var names = ['Anchor Point', 'Position', 'Scale', 'Rotation', 'Opacity'];
        for (var i = 0; i < names.length; i++) {
            var p = group.property(names[i]);
            if (!p) { continue; }
            var v = p.value;
            data.transform[names[i]] = (v && typeof v.length === 'number') ? [v[0], v[1], v[2]] : v;
        }
        var parade = layer.property('Effects');
        for (var e = 1; e <= parade.numProperties; e++) {
            var fx = parade.property(e);
            if (!fx) { continue; }
            var params = {};
            for (var q = 1; q <= fx.numProperties; q++) {
                var child = fx.property(q);
                if (!child) { continue; }
                var val = child.value;
                if (val && typeof val === 'object' && typeof val.length !== 'number') { continue; }
                params[child.name] = val;
            }
            data.effects.push({ name: fx.name, matchName: fx.matchName, params: params });
        }
        var all = loadPresets();
        all[name] = data;
        savePresets(all);
        return { ok: true, name: name, message: 'Saved preset "' + name + '".' };
    }

    function listPresets() {
        var map = loadPresets();
        var out = [];
        for (var k in map) {
            if (map.hasOwnProperty(k)) { out.push(map[k]); }
        }
        out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return { ok: true, presets: out };
    }

    function deletePreset(name) {
        var map = loadPresets();
        if (!map[name]) { throw new Error('No preset named "' + name + '".'); }
        delete map[name];
        savePresets(map);
        return { ok: true, message: 'Deleted preset "' + name + '".' };
    }

    function applyPreset(name, opts) {
        opts = opts || {};
        comp();
        var map = loadPresets();
        var data = map[name];
        if (!data) { throw new Error('No preset named "' + name + '".'); }
        var list = opts.layers || layers();
        if (!list.length) { throw new Error('Select at least one layer.'); }
        app.beginUndoGroup('KitFX - Apply preset');
        for (var i = 0; i < list.length; i++) {
            var layer = list[i];
            var group = layer.property('Transform');
            for (var key in data.transform) {
                if (!data.transform.hasOwnProperty(key)) { continue; }
                try { group.property(key).setValue(data.transform[key]); } catch (e) { }
            }
            var parade = layer.property('Effects');
            for (var e = 0; e < data.effects.length; e++) {
                var src = data.effects[e];
                var target = findEffect(layer, src.name);
                if (!target) {
                    try { target = parade.addProperty(src.matchName); target.name = src.name; }
                    catch (e2) { target = null; }
                }
                if (!target) { continue; }
                for (var pname in src.params) {
                    if (!src.params.hasOwnProperty(pname)) { continue; }
                    try { target.property(pname).setValue(src.params[pname]); } catch (e3) { }
                }
            }
        }
        app.endUndoGroup();
        return { ok: true, applied: list.length, message: 'Applied "' + name + '" to ' + list.length + ' layer' + (list.length === 1 ? '' : 's') + '.' };
    }

    /* ---------------------------------------------------------------- */
    /* motion presets                                                    */
    /* ---------------------------------------------------------------- */

    function ensureKey(prop, time, value) {
        prop.setValueAtTime(time, value);
        var idx = 0;
        for (var i = 1; i <= prop.numKeys; i++) {
            if (Math.abs(prop.keyTime(i) - time) < 0.002) { idx = i; break; }
        }
        if (idx) {
            var dims = dimsOf(prop);
            var inArr = [], outArr = [];
            for (var d = 0; d < dims; d++) {
                inArr.push(new KeyframeEase(0, 33.33));
                outArr.push(new KeyframeEase(0, 33.33));
            }
            try { prop.setTemporalEaseAtKey(idx, inArr, outArr); } catch (e) { }
        }
        return idx;
    }

    var MOTION = {
        'pop-in': 'Pop in',
        'fade-in': 'Fade',
        'slide-up': 'Slide up',
        'slide-left': 'Slide left',
        'spin-in': 'Spin in',
        'punch': 'Punch'
    };

    function motionPreset(preset, duration, opts) {
        opts = opts || {};
        var c = comp();
        var list = opts.layers || layers();
        if (!list.length) { throw new Error('Select at least one layer.'); }
        if (!MOTION[preset]) { throw new Error('Unknown motion preset: ' + preset); }
        var dur = num(duration, 0.6);
        var fd = c.frameDuration;
        var applied = 0;

        app.beginUndoGroup('KitFX - Motion preset');
        for (var i = 0; i < list.length; i++) {
            var layer = list[i];
            var group = layer.property('Transform');
            var t0 = layer.inPoint;
            var t1 = t0 + dur;
            var pos = group.property('Position');
            var scale = group.property('Scale');
            var opacity = group.property('Opacity');
            var rot = group.property('Rotation');
            var startPos = pos.value;
            var startScale = scale.value;
            var startRot = rot ? rot.value : 0;

            if (preset === 'pop-in') {
                ensureKey(scale, t0, [startScale[0] * 0.55, startScale[1] * 0.55]);
                ensureKey(scale, t1, [startScale[0], startScale[1]]);
                ensureKey(opacity, t0, 0);
                ensureKey(opacity, t1, 100);
            } else if (preset === 'fade-in') {
                ensureKey(opacity, t0, 0);
                ensureKey(opacity, t1, 100);
            } else if (preset === 'slide-up') {
                ensureKey(pos, t0, [startPos[0], startPos[1] + 60]);
                ensureKey(pos, t1, [startPos[0], startPos[1]]);
                ensureKey(opacity, t0, 0);
                ensureKey(opacity, t1, 100);
            } else if (preset === 'slide-left') {
                ensureKey(pos, t0, [startPos[0] + 80, startPos[1]]);
                ensureKey(pos, t1, [startPos[0], startPos[1]]);
                ensureKey(opacity, t0, 0);
                ensureKey(opacity, t1, 100);
            } else if (preset === 'spin-in') {
                if (rot) { ensureKey(rot, t0, startRot - 25); ensureKey(rot, t1, startRot); }
                ensureKey(scale, t0, [startScale[0] * 0.8, startScale[1] * 0.8]);
                ensureKey(scale, t1, [startScale[0], startScale[1]]);
                ensureKey(opacity, t0, 0);
                ensureKey(opacity, t1, 100);
            } else if (preset === 'punch') {
                ensureKey(scale, t0, [startScale[0] * 1.18, startScale[1] * 1.18]);
                ensureKey(scale, t0 + fd * 2, [startScale[0] * 0.97, startScale[1] * 0.97]);
                ensureKey(scale, t1, [startScale[0], startScale[1]]);
            }
            applied++;
        }
        app.endUndoGroup();
        return { ok: true, applied: applied, message: 'Applied "' + MOTION[preset] + '" to ' + applied + ' layer' + (applied === 1 ? '' : 's') + '.' };
    }

    /* ---------------------------------------------------------------- */
    /* diagnostics                                                       */
    /* ---------------------------------------------------------------- */

    function health() {
        var checks = [];
        var aeOk = !!app.version;
        checks.push({ label: 'EffectCraft', ok: aeOk, detail: String(app.version) });
        var projectOk = !!app.project;
        checks.push({ label: 'Project open', ok: projectOk, detail: projectOk ? String(app.project.name) : 'none' });
        var compOk = false, compDetail = 'no active composition';
        try {
            if (app.project.activeItem instanceof CompItem) {
                compOk = true;
                var c = app.project.activeItem;
                compDetail = c.name + ' - ' + c.width + 'x' + c.height;
            }
        } catch (e) { }
        checks.push({ label: 'Active composition', ok: compOk, detail: compDetail });
        var settingsOk = false;
        try {
            app.settings.saveSetting(SETTINGS_SECTION, 'probe', 'ok');
            settingsOk = app.settings.getSetting(SETTINGS_SECTION, 'probe') === 'ok';
        } catch (e2) { }
        checks.push({ label: 'Settings storage', ok: settingsOk, detail: settingsOk ? 'writing' : 'unavailable' });
        return { ok: true, version: VERSION, checks: checks };
    }

    /* ---------------------------------------------------------------- */

    return {
        version: VERSION,
        context: context,
        health: health,
        applyEase: applyEase,
        readEase: readEase,
        copyEase: copyEase,
        pasteEase: pasteEase,
        copyValues: copyValues,
        pasteValues: pasteValues,
        align: align,
        distribute: distribute,
        setAnchor: setAnchor,
        addMarkers: addMarkers,
        clearMarkers: clearMarkers,
        applySpring: applySpring,
        removeSpring: removeSpring,
        importCaptions: importCaptions,
        savePreset: savePreset,
        listPresets: listPresets,
        applyPreset: applyPreset,
        deletePreset: deletePreset,
        motionPreset: motionPreset,
        presets: { ease: EASE_PRESETS, motion: MOTION, spring: SPRING_PARAMS }
    };
})();

if (typeof $.global !== 'undefined') { $.global.KitFX = KitFX; }



/* ================= kitfx-srt.jsx ================= */
/* KitFX for EffectCraft - SRT / WebVTT parsing. ES5, no dependencies. */
var KitFXSrt = (function () {
    function parseTime(raw) {
        var s = String(raw).trim().replace(',', '.');
        var m = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})$/.exec(s);
        if (m) {
            return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 +
                parseInt(m[3], 10) + parseInt((m[4] + '00').slice(0, 3), 10) / 1000;
        }
        m = /^(\d{1,2}):(\d{2})\.(\d{1,3})$/.exec(s);
        if (m) {
            return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) +
                parseInt((m[3] + '00').slice(0, 3), 10) / 1000;
        }
        return null;
    }

    function cleanLine(line) {
        return String(line)
            .replace(/<[^>]+>/g, '')
            .replace(/\{\\[^}]*\}/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parse(input) {
        var text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        var format = /^WEBVTT/i.test(text.replace(/^\s+/, '')) ? 'vtt' : 'srt';
        var blocks = text.split(/\n{2,}/);
        var cues = [];
        var warnings = [];

        for (var b = 0; b < blocks.length; b++) {
            var block = blocks[b].replace(/^\s+|\s+$/g, '');
            if (!block) { continue; }
            if (/^WEBVTT/i.test(block) || /^NOTE\b/i.test(block) || /^STYLE\b/i.test(block)) { continue; }

            var lines = block.split('\n');
            var arrowAt = -1;
            for (var i = 0; i < lines.length && i < 3; i++) {
                if (lines[i].indexOf('-->') >= 0) { arrowAt = i; break; }
            }
            if (arrowAt < 0) { continue; }

            var timing = lines[arrowAt].split('-->');
            if (timing.length < 2) { continue; }
            var start = parseTime(timing[0]);
            var end = parseTime(timing[1].replace(/^\s+/, '').split(/\s+/)[0]);
            if (start === null || end === null) {
                warnings.push('Skipped a cue with unreadable timing.');
                continue;
            }
            if (end <= start) { end = start + 0.5; }

            var body = [];
            for (var l = arrowAt + 1; l < lines.length; l++) {
                var cleaned = cleanLine(lines[l]);
                if (cleaned) { body.push(cleaned); }
            }
            if (!body.length) { continue; }

            cues.push({
                index: cues.length + 1,
                start: Math.round(start * 1000) / 1000,
                end: Math.round(end * 1000) / 1000,
                text: body.join('\n')
            });
        }

        cues.sort(function (a, c) { return a.start - c.start; });
        for (var k = 0; k < cues.length; k++) { cues[k].index = k + 1; }
        return { cues: cues, format: format, warnings: warnings };
    }

    function formatTime(sec) {
        var t = Math.max(0, sec);
        var h = Math.floor(t / 3600);
        var m = Math.floor((t % 3600) / 60);
        var s = Math.floor(t % 60);
        var ms = Math.round((t - Math.floor(t)) * 1000);
        function pad(n, w) { var v = String(n); while (v.length < w) { v = '0' + v; } return v; }
        return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
    }

    return { parse: parse, parseTime: parseTime, formatTime: formatTime };
})();

if (typeof $.global !== 'undefined') { $.global.KitFXSrt = KitFXSrt; }


/* ================= kitfx-ui.jsx ================= */
/*
 * KitFX for EffectCraft - ScriptUI panel.
 *
 * Dockable from Window > KitFX. The same file, run from File > Scripts,
 * opens as a floating palette. The tool selector keeps the panel usable in a
 * narrow dock (about 250 px wide).
 */
var KitFXUI = (function () {
    function build(thisObj) {
        var ui = thisObj instanceof Panel
            ? thisObj
            : new Window('palette', 'KitFX', undefined, { resizeable: true });

        ui.orientation = 'column';
        ui.alignChildren = ['fill', 'top'];
        ui.spacing = 8;
        ui.margins = 10;

        var status;
        var pages = [];
        var current = 0;

        function setStatus(message) {
            if (status) { status.text = String(message); }
        }

        function fail(e) {
            setStatus((e && e.message) ? e.message : String(e));
        }

        function act(fn) {
            try {
                var result = fn();
                if (result && result.message) { setStatus(result.message); }
                refreshContext();
            } catch (e) {
                fail(e);
            }
        }

        function row(parent, spacing) {
            var g = parent.add('group');
            g.orientation = 'row';
            g.alignChildren = ['fill', 'center'];
            g.spacing = spacing === undefined ? 6 : spacing;
            return g;
        }

        function actionButton(parent, label, width, onClick) {
            var b = parent.add('button', undefined, label);
            if (width) { b.preferredSize = [width, 24]; }
            b.alignment = ['fill', 'center'];
            b.onClick = onClick;
            return b;
        }

        function sliderRow(parent, labelText, min, max, value, formatter) {
            var line = row(parent);
            var label = line.add('statictext', undefined, labelText);
            label.characters = 10;
            var slider = line.add('slider', undefined, value, min, max);
            slider.alignment = ['fill', 'center'];
            slider.preferredSize = [110, 20];
            // Editable value: EffectCraft 0.18 draws a slider as a handle without
            // a track, so typing is the reliable way to set an exact number.
            var readout = line.add('edittext', undefined, formatter(value));
            readout.characters = 6;
            readout.alignment = ['right', 'center'];
            slider.onChanging = function () { readout.text = formatter(slider.value); };
            readout.onChange = function () {
                var parsed = parseFloat(readout.text);
                if (!isNaN(parsed)) {
                    if (parsed < min) { parsed = min; }
                    if (parsed > max) { parsed = max; }
                    slider.value = parsed;
                }
                readout.text = formatter(slider.value);
            };
            return { slider: slider, readout: readout };
        }

        function heading(parent, text) {
            var t = parent.add('statictext', undefined, text);
            t.graphics.font = ScriptUI.newFont('Segoe UI', 'BOLD', 11);
            return t;
        }

        function hint(parent, text) {
            var t = parent.add('statictext', undefined, text);
            t.characters = 30;
            return t;
        }

        function page(title) {
            var p = ui.add('group');
            p.orientation = 'column';
            p.alignChildren = ['fill', 'top'];
            p.spacing = 6;
            p.alignment = ['fill', 'top'];
            p.visible = false;
            pages.push(p);
            return p;
        }

        /* ------------------------------------------------------------ */
        /* header                                                       */
        /* ------------------------------------------------------------ */

        var header = row(ui, 8);
        var brand = header.add('statictext', undefined, 'KitFX');
        brand.graphics.font = ScriptUI.newFont('Segoe UI', 'BOLD', 16);
        var version = header.add('statictext', undefined, 'v' + KitFX.version);
        version.alignment = ['left', 'bottom'];

        var filler = header.add('group');
        filler.alignment = ['fill', 'center'];

        var checkBtn = actionButton(header, 'Info', 52, function () {
            try {
                var h = KitFX.health();
                var text = 'KitFX ' + h.version + '\n\n';
                for (var i = 0; i < h.checks.length; i++) {
                    text += (h.checks[i].ok ? 'OK  ' : '--  ') + h.checks[i].label + ': ' + h.checks[i].detail + '\n';
                }
                try { alert(text); } catch (e) { setStatus(text.replace(/\n/g, ' - ')); }
            } catch (e2) { fail(e2); }
        });

        var ctxLabel = ui.add('statictext', undefined, 'Open a composition.');
        ctxLabel.characters = 26;

        var toolRow = row(ui);
        var toolLabel = toolRow.add('statictext', undefined, 'Tool');
        toolLabel.characters = 4;
        var toolList = toolRow.add('dropdownlist', undefined,
            ['Curve', 'Align', 'Beat', 'Spring', 'Captions', 'Library']);
        toolList.selection = 0;
        toolList.alignment = ['fill', 'center'];
        toolList.onChange = function () {
            showPage(toolList.selection.index);
            try { app.settings.saveSetting('KitFX', 'tool', String(toolList.selection.index)); } catch (eSave) { }
        };

        /* ------------------------------------------------------------ */
        /* Curve                                                        */
        /* ------------------------------------------------------------ */

        var curveTab = page('Curve');

        heading(curveTab, 'Ease presets');
        var presetGrid = [
            [['easy', 'Easy'], ['smooth', 'Smooth'], ['snap', 'Snap']],
            [['soft', 'Soft'], ['strong', 'Strong'], ['anticipate', 'Anticipate']]
        ];
        for (var r = 0; r < presetGrid.length; r++) {
            var presetRow = row(curveTab);
            for (var c = 0; c < presetGrid[r].length; c++) {
                (function (spec) {
                    actionButton(presetRow, spec[1], 0, function () {
                        curveIn.slider.value = KitFX.presets.ease[spec[0]].inInf;
                        curveOut.slider.value = KitFX.presets.ease[spec[0]].outInf;
                        curveIn.readout.text = Math.round(curveIn.slider.value) + '%';
                        curveOut.readout.text = Math.round(curveOut.slider.value) + '%';
                        act(function () {
                            return KitFX.applyEase({
                                preset: spec[0],
                                inInfluence: curveIn.slider.value,
                                outInfluence: curveOut.slider.value
                            });
                        });
                    });
                })(presetGrid[r][c]);
            }
        }

        var curveIn = sliderRow(curveTab, 'Ease in', 0, 100, 33.33, function (v) { return Math.round(v) + '%'; });
        var curveOut = sliderRow(curveTab, 'Ease out', 0, 100, 33.33, function (v) { return Math.round(v) + '%'; });

        var curveApplyRow = row(curveTab);
        actionButton(curveApplyRow, 'Apply ease', 0, function () {
            act(function () {
                return KitFX.applyEase({
                    preset: 'custom',
                    inInfluence: curveIn.slider.value,
                    outInfluence: curveOut.slider.value
                });
            });
        });

        var curveModeRow = row(curveTab);
        actionButton(curveModeRow, 'Linear', 0, function () {
            act(function () { return KitFX.applyEase({ mode: 'linear' }); });
        });
        actionButton(curveModeRow, 'Hold', 0, function () {
            act(function () { return KitFX.applyEase({ mode: 'hold' }); });
        });
        actionButton(curveModeRow, 'Auto', 0, function () {
            act(function () { return KitFX.applyEase({ mode: 'auto' }); });
        });

        heading(curveTab, 'Clipboard');
        var curveClipRow = row(curveTab);
        actionButton(curveClipRow, 'Copy ease', 0, function () {
            act(function () { return KitFX.copyEase(); });
        });
        actionButton(curveClipRow, 'Paste ease', 0, function () {
            act(function () { return KitFX.pasteEase(); });
        });

        var curveValueRow = row(curveTab);
        actionButton(curveValueRow, 'Copy values', 0, function () {
            act(function () { return KitFX.copyValues(); });
        });
        actionButton(curveValueRow, 'Paste values', 0, function () {
            act(function () { return KitFX.pasteValues(); });
        });

        hint(curveTab, 'Select keyframes in the Timeline first.');

        /* ------------------------------------------------------------ */
        /* Align                                                        */
        /* ------------------------------------------------------------ */

        var alignTab = page('Align');

        heading(alignTab, 'Align to composition');
        var alignGrid = [
            [['left', 'top', 'TL'], ['none', 'top', 'T'], ['right', 'top', 'TR']],
            [['left', 'none', 'L'], ['hcenter', 'vcenter', 'C'], ['right', 'none', 'R']],
            [['left', 'bottom', 'BL'], ['none', 'bottom', 'B'], ['right', 'bottom', 'BR']]
        ];
        for (var ar = 0; ar < alignGrid.length; ar++) {
            var arow = row(alignTab, 4);
            for (var ac = 0; ac < 3; ac++) {
                (function (spec) {
                    actionButton(arow, spec[2], 0, function () {
                        act(function () {
                            return KitFX.align({
                                h: spec[0], v: spec[1],
                                margin: alignMargin(),
                                reference: alignReference.selection.text
                            });
                        });
                    });
                })(alignGrid[ar][ac]);
            }
        }

        var alignOpts = row(alignTab);
        var marginLabel = alignOpts.add('statictext', undefined, 'Margin');
        marginLabel.characters = 6;
        var alignMarginField = alignOpts.add('edittext', undefined, '0');
        alignMarginField.characters = 5;
        var marginUnit = alignOpts.add('statictext', undefined, 'px');
        marginUnit.characters = 2;
        function alignMargin() {
            var v = parseFloat(alignMarginField.text);
            return isNaN(v) ? 0 : v;
        }

        var refRow = row(alignTab);
        var refLabel = refRow.add('statictext', undefined, 'Reference');
        refLabel.characters = 9;
        var alignReference = refRow.add('dropdownlist', undefined, ['Composition', 'Last selected']);
        alignReference.selection = 0;
        alignReference.alignment = ['fill', 'center'];

        heading(alignTab, 'Distribute');
        var distRow = row(alignTab);
        actionButton(distRow, 'Spread H', 0, function () {
            act(function () { return KitFX.distribute('horizontal'); });
        });
        actionButton(distRow, 'Spread V', 0, function () {
            act(function () { return KitFX.distribute('vertical'); });
        });

        heading(alignTab, 'Anchor point');
        var anchorRow = row(alignTab);
        var anchorList = anchorRow.add('dropdownlist', undefined,
            ['Center', 'Top left', 'Top right', 'Bottom left', 'Bottom right', 'Left', 'Right', 'Top', 'Bottom']);
        anchorList.selection = 0;
        anchorList.alignment = ['fill', 'center'];
        actionButton(anchorRow, 'Move', 48, function () {
            var values = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'top', 'bottom'];
            act(function () { return KitFX.setAnchor(values[anchorList.selection.index]); });
        });

        /* ------------------------------------------------------------ */
        /* Beat                                                         */
        /* ------------------------------------------------------------ */

        var beatTab = page('Beat');

        var beatTargetRow = row(beatTab);
        var beatTargetLabel = beatTargetRow.add('statictext', undefined, 'Target');
        beatTargetLabel.characters = 6;
        var beatTarget = beatTargetRow.add('dropdownlist', undefined, ['Composition', 'Selected layer']);
        beatTarget.selection = 0;
        beatTarget.alignment = ['fill', 'center'];

        var bpmRow = row(beatTab);
        var bpmLabel = bpmRow.add('statictext', undefined, 'Tempo');
        bpmLabel.characters = 6;
        var bpmField = bpmRow.add('edittext', undefined,
            String(app.settings.haveSetting('KitFX', 'bpm') ? app.settings.getSetting('KitFX', 'bpm') : '120'));
        bpmField.characters = 5;
        var bpmUnit = bpmRow.add('statictext', undefined, 'BPM');
        bpmUnit.characters = 3;
        var taps = [];
        actionButton(bpmRow, 'Tap', 40, function () {
            var now = new Date().getTime();
            if (taps.length && now - taps[taps.length - 1] > 2000) { taps = []; }
            taps.push(now);
            if (taps.length >= 2) {
                var total = 0;
                for (var i = 1; i < taps.length; i++) { total += taps[i] - taps[i - 1]; }
                var bpm = Math.round(60000 / (total / (taps.length - 1)));
                if (bpm >= 20 && bpm <= 400) {
                    bpmField.text = String(bpm);
                    setStatus(bpm + ' BPM');
                }
            } else {
                setStatus('Tap again to set the tempo.');
            }
        });

        var divisionRow = row(beatTab);
        var divisionLabel = divisionRow.add('statictext', undefined, 'Division');
        divisionLabel.characters = 8;
        var divisionList = divisionRow.add('dropdownlist', undefined,
            ['1/1 beat', '1/2 half', '1/4 quarter', '1/8 eighth', '1/16 sixteenth']);
        divisionList.selection = 0;
        divisionList.alignment = ['fill', 'center'];

        var offsetRow = row(beatTab);
        var offsetLabel = offsetRow.add('statictext', undefined, 'Offset');
        offsetLabel.characters = 6;
        var offsetField = offsetRow.add('edittext', undefined, '0');
        offsetField.characters = 5;
        var offsetUnit = offsetRow.add('statictext', undefined, 's');
        offsetUnit.characters = 2;

        var workAreaCheck = beatTab.add('checkbox', undefined, 'Use the work area');
        workAreaCheck.value = true;

        var beatButtons = row(beatTab);
        actionButton(beatButtons, 'Place markers', 0, function () {
            act(function () {
                var divisions = [1, 2, 4, 8, 16];
                var bpm = parseFloat(bpmField.text);
                var offset = parseFloat(offsetField.text);
                return KitFX.addMarkers({
                    target: beatTarget.selection.index === 1 ? 'layer' : 'comp',
                    bpm: isNaN(bpm) ? 120 : bpm,
                    division: divisions[divisionList.selection.index],
                    offset: isNaN(offset) ? 0 : offset,
                    useWorkArea: workAreaCheck.value,
                    prefix: 'KitFX'
                });
            });
            try { app.settings.saveSetting('KitFX', 'bpm', bpmField.text); } catch (e) { }
        });
        actionButton(beatButtons, 'Clear', 0, function () {
            act(function () { return KitFX.clearMarkers({ scope: 'both' }); });
        });

        hint(beatTab, 'Markers snap to frames. Only KitFX markers are replaced.');

        /* ------------------------------------------------------------ */
        /* Spring                                                       */
        /* ------------------------------------------------------------ */

        var springTab = page('Spring');

        heading(springTab, 'Shape');
        var springAmount = sliderRow(springTab, 'Amount', 0, 200, 24, function (v) { return Math.round(v); });
        var springFrequency = sliderRow(springTab, 'Frequency', 0.5, 12, 3.2, function (v) { return v.toFixed(1); });
        var springDecay = sliderRow(springTab, 'Decay', 0.5, 30, 6, function (v) { return v.toFixed(1); });
        var springDelay = sliderRow(springTab, 'Delay', 0, 1.5, 0, function (v) { return v.toFixed(2); });

        var springButtons = row(springTab);
        actionButton(springButtons, 'Apply spring', 0, function () {
            act(function () {
                return KitFX.applySpring({
                    amount: springAmount.slider.value,
                    frequency: springFrequency.slider.value,
                    decay: springDecay.slider.value,
                    delay: springDelay.slider.value
                });
            });
        });
        actionButton(springButtons, 'Remove', 0, function () {
            act(function () { return KitFX.removeSpring(); });
        });

        hint(springTab, 'Select a keyframed property. Sliders appear in Effect Controls.');

        /* ------------------------------------------------------------ */
        /* Captions                                                     */
        /* ------------------------------------------------------------ */

        var captionTab = page('Captions');
        var cues = [];

        heading(captionTab, 'Subtitles');
        var srtRow = row(captionTab);
        actionButton(srtRow, 'Load SRT / VTT', 0, function () {
            try {
                var f = File.openDialog('Choose a subtitle file', '*.srt;*.vtt;*.txt');
                if (!f) { return; }
                f.encoding = 'UTF-8';
                if (!f.open('r')) { throw new Error('Could not open the file.'); }
                var text = f.read();
                f.close();
                var parsed = KitFXSrt.parse(text);
                cues = parsed.cues;
                if (!cues.length) { throw new Error('No cues found in that file.'); }
                setStatus('Loaded ' + cues.length + ' cues.');
            } catch (e) {
                fail(e);
                setStatus('File access is blocked. Paste the SRT below, or allow scripts to read files.');
            }
            refreshContext();
        });

        var pasteLabel = captionTab.add('statictext', undefined, 'or paste SRT text:');
        pasteLabel.characters = 20;
        var pasteField = captionTab.add('edittext', undefined, '', { multiline: true });
        pasteField.preferredSize = [-1, 70];
        try { pasteField.multiline = true; } catch (eM) { }

        var capStyleRow = row(captionTab);
        var sizeLabel = capStyleRow.add('statictext', undefined, 'Size');
        sizeLabel.characters = 4;
        var capSize = capStyleRow.add('edittext', undefined, '0');
        capSize.characters = 4;
        var colorLabel = capStyleRow.add('statictext', undefined, 'Color');
        colorLabel.characters = 5;
        var capColor = capStyleRow.add('edittext', undefined, 'ffffff');
        capColor.characters = 6;

        var capY = sliderRow(captionTab, 'Position', 20, 95, 86, function (v) { return Math.round(v) + '%'; });

        var capButtons = row(captionTab);
        actionButton(capButtons, 'Import captions', 0, function () {
            act(function () {
                if (!cues.length) {
                    cues = KitFXSrt.parse(pasteField.text).cues;
                }
                if (!cues.length) { throw new Error('Load a file or paste SRT text first.'); }
                var c = app.project.activeItem;
                if (!(c instanceof CompItem)) { throw new Error('Open a composition first.'); }
                var fontSize = parseFloat(capSize.text);
                return KitFX.importCaptions(cues, {
                    y: c.height * (capY.slider.value / 100),
                    style: {
                        fontSize: isNaN(fontSize) || fontSize <= 0 ? undefined : fontSize,
                        color: '#' + String(capColor.text).replace('#', '')
                    }
                });
            });
        });

        hint(captionTab, 'One text layer per cue, timed from the file.');

        /* ------------------------------------------------------------ */
        /* Library                                                      */
        /* ------------------------------------------------------------ */

        var libraryTab = page('Library');

        heading(libraryTab, 'Motion presets');
        var motionRow = row(libraryTab);
        var motionList = motionRow.add('dropdownlist', undefined,
            ['Pop in', 'Fade', 'Slide up', 'Slide left', 'Spin in', 'Punch']);
        motionList.selection = 0;
        motionList.alignment = ['fill', 'center'];
        actionButton(motionRow, 'Motion', 46, function () {
            var ids = ['pop-in', 'fade-in', 'slide-up', 'slide-left', 'spin-in', 'punch'];
            act(function () { return KitFX.motionPreset(ids[motionList.selection.index], 0.6); });
        });

        heading(libraryTab, 'Saved presets');
        var saveRow = row(libraryTab);
        var presetName = saveRow.add('edittext', undefined, '');
        presetName.characters = 10;
        presetName.alignment = ['fill', 'center'];
        actionButton(saveRow, 'Save', 46, function () {
            act(function () { return KitFX.savePreset(presetName.text); });
            reloadPresets();
        });

        var presetList = libraryTab.add('listbox', undefined, []);
        presetList.preferredSize = [-1, 70];
        presetList.alignment = ['fill', 'top'];

        var presetButtons = row(libraryTab);
        actionButton(presetButtons, 'Preset', 0, function () {
            if (!presetList.selection) { setStatus('Select a preset first.'); return; }
            act(function () { return KitFX.applyPreset(presetList.selection.text); });
        });
        actionButton(presetButtons, 'Delete', 0, function () {
            if (!presetList.selection) { setStatus('Select a preset first.'); return; }
            act(function () { return KitFX.deletePreset(presetList.selection.text); });
            reloadPresets();
        });
        actionButton(presetButtons, 'Refresh', 0, reloadPresets);

        function reloadPresets() {
            try {
                presetList.removeAll();
                var res = KitFX.listPresets();
                for (var i = 0; i < res.presets.length; i++) {
                    presetList.add('item', res.presets[i].name);
                }
                if (res.presets.length) { setStatus(res.presets.length + ' saved preset' + (res.presets.length === 1 ? '' : 's') + '.'); }
            } catch (e) { }
        }
        reloadPresets();

        /* ------------------------------------------------------------ */
        /* footer + lifecycle                                           */
        /* ------------------------------------------------------------ */

        status = ui.add('statictext', undefined, 'Ready.');
        status.characters = 30;

        function showPage(index) {
            current = index;
            for (var i = 0; i < pages.length; i++) {
                pages[i].visible = (i === index);
            }
            try { ui.layout.layout(true); } catch (e) { }
        }

        function refreshContext() {
            try {
                var c = app.project.activeItem;
                if (!(c instanceof CompItem)) {
                    ctxLabel.text = 'Open a composition.';
                    return;
                }
                var sel = c.selectedLayers;
                var keys = 0;
                var props = c.selectedProperties || [];
                for (var i = 0; i < props.length; i++) {
                    try { keys += props[i].selectedKeys ? props[i].selectedKeys.length : 0; } catch (e) { }
                }
                ctxLabel.text = c.name + ' - ' + sel.length + ' layer' + (sel.length === 1 ? '' : 's') +
                    (keys ? ', ' + keys + ' key' + (keys === 1 ? '' : 's') : '');
            } catch (e) {
                ctxLabel.text = 'Open a composition.';
            }
        }

        ui.onResizing = ui.onResize = function () {
            try { this.layout.resize(); } catch (e) { }
        };

        var savedTool = 0;
        try {
            if (app.settings.haveSetting('KitFX', 'tool')) {
                savedTool = parseInt(app.settings.getSetting('KitFX', 'tool'), 10);
                if (isNaN(savedTool) || savedTool < 0 || savedTool >= pages.length) { savedTool = 0; }
            }
        } catch (eTool) { savedTool = 0; }
        toolList.selection = savedTool;
        showPage(savedTool);
        refreshContext();
        setStatus('Ready.');

        if (ui instanceof Window) {
            ui.center();
            ui.show();
        } else {
            ui.layout.layout(true);
            try { ui.layout.resize(); } catch (e) { }
        }
        return ui;
    }

    return { build: build };
})();


if (!(typeof KITFX_TEST !== 'undefined' && KITFX_TEST)) {
    KitFXUI.build(thisObj);
}
})(this);
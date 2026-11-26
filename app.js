(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('has-js');

  const modal = document.querySelector('#video-modal');
  const frame = modal?.querySelector('iframe');
  const closeButton = modal?.querySelector('.video-modal-close');
  const fullscreenButton = modal?.querySelector('.video-modal-fullscreen');
  const fullscreenLabel = fullscreenButton?.querySelector('.video-fullscreen-label');
  const pdfReader = document.querySelector('#pdf-reader');
  const pdfTitle = pdfReader?.querySelector('#pdf-reader-title');
  const pdfKicker = pdfReader?.querySelector('.pdf-reader-kicker');
  const pdfCloseButton = pdfReader?.querySelector('.pdf-reader-close');
  const pdfPages = document.querySelector('#pdf-pages');
  const pdfFallback = document.querySelector('#pdf-fallback');
  const pdfViewport = document.querySelector('#pdf-viewport');
  const pdfStatus = document.querySelector('#pdf-status');
  const pdfZoomLabel = document.querySelector('#pdf-zoom-level');
  const pdfZoomOut = document.querySelector('#pdf-zoom-out');
  const pdfZoomIn = document.querySelector('#pdf-zoom-in');
  let returnFocusTo = null;
  let pdfReturnFocusTo = null;
  let pageOverflowBeforePdf = '';
  let pdfDocument = null;
  let pdfLoadingTask = null;
  let pdfRenderTasks = [];
  let pdfSession = 0;
  let pdfRenderVersion = 0;
  let pdfZoom = 1;
  let pdfCurrentUrl = '';
  let pdfResizeTimer = 0;
  let pdfPanPointer = null;
  const pdfTouchPointers = new Map();
  let pdfPinch = null;
  const videoModalInner = modal?.querySelector('.video-modal-inner');
  const autoplayDriveIds = new Set([
    '1vohawd993ZlIki3L_fiTOm51hii_xUgi',
    '13St_mh7zPXuKfpGUFR9MuVru3JUCpy8x'
  ]);
  const videoLinks = [...document.querySelectorAll('.portfolio-grid .shot[data-drive-id]')]
    .filter((link) => autoplayDriveIds.has(link.dataset.driveId));
  const videoVisibility = new Map(videoLinks.map((link) => [link, 0]));
  let activeVideoLink = null;
  let hasUserScrolled = false;

  const clearInlineVideoSizing = () => {
    ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'transform', 'transform-origin'].forEach((property) => {
      frame?.style.removeProperty(property);
    });
  };

  const sizeInlineVideo = (link) => {
    if (!frame || !link) return;
    const { width, height } = link.getBoundingClientRect();
    if (!width || !height) return;
    const minimumViewport = 520;
    const scaleUp = Math.max(1, minimumViewport / width, minimumViewport / height);
    frame.style.position = 'absolute';
    frame.style.left = '50%';
    frame.style.top = '50%';
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
    frame.style.width = `${Math.ceil(width * scaleUp)}px`;
    frame.style.height = `${Math.ceil(height * scaleUp)}px`;
    frame.style.transform = `translate(-50%, -50%) scale(${1 / scaleUp})`;
    frame.style.transformOrigin = 'center';
  };

  const syncFullscreenButton = () => {
    const isFullscreen = Boolean(modal?.contains(document.fullscreenElement));
    fullscreenButton?.setAttribute('aria-label', isFullscreen ? 'Exit video fullscreen' : 'Watch video fullscreen');
    if (fullscreenLabel) fullscreenLabel.textContent = isFullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
  };

  const toggleFullscreen = async () => {
    if (!modal) return;

    try {
      if (document.fullscreenElement && modal?.contains(document.fullscreenElement)) {
        await document.exitFullscreen();
      } else if (modal.requestFullscreen) {
        await modal.requestFullscreen();
      } else if (modal.webkitRequestFullscreen) {
        modal.webkitRequestFullscreen();
      } else if (frame?.requestFullscreen) {
        await frame.requestFullscreen();
      } else if (frame?.src) {
        window.open(frame.src, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // Keep the embedded player usable if fullscreen is unavailable or declined.
    }
  };

  const mountVideo = (link, container) => {
    if (!frame || !link || !container) return;
    const id = link.dataset.driveId;
    if (!id) return;

    activeVideoLink = link;
    frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    frame.allowFullscreen = true;
    frame.title = `Portfolio video: ${link.closest('.card')?.querySelector('.info h3')?.textContent.trim() || link.querySelector('img')?.alt || 'video preview'}`;
    if (container === link) {
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      sizeInlineVideo(link);
    } else {
      frame.removeAttribute('tabindex');
      frame.removeAttribute('aria-hidden');
      clearInlineVideoSizing();
    }

    const needsLoad = frame.dataset.driveId !== id;
    if (frame.parentElement !== container) container.appendChild(frame);
    if (needsLoad) {
      frame.removeAttribute('src');
      frame.dataset.driveId = id;
      frame.src = `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview?autoplay=1`;
    }
  };

  const stopCardPlayback = () => {
    if (!frame || modal?.classList.contains('open')) return;
    frame.removeAttribute('src');
    delete frame.dataset.driveId;
    frame.remove();
    activeVideoLink = null;
  };

  const closeVideo = ({ restoreFocus = true } = {}) => {
    if (!modal || !frame || !modal.classList.contains('open')) return;

    if (document.fullscreenElement && modal.contains(document.fullscreenElement)) {
      document.exitFullscreen?.().catch(() => {});
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (activeVideoLink?.isConnected && videoLinks.includes(activeVideoLink)) {
      mountVideo(activeVideoLink, activeVideoLink);
    } else {
      stopCardPlayback();
      requestAnimationFrame(selectVisibleVideo);
    }
    document.body.style.overflow = '';

    if (restoreFocus && returnFocusTo instanceof HTMLElement) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
  };

  const openVideo = (link) => {
    if (!modal || !frame || !closeButton || !videoModalInner) return;

    returnFocusTo = link;
    mountVideo(link, videoModalInner);
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeButton.focus();
  };

  const cancelPdfRenderTasks = () => {
    pdfRenderTasks.forEach((task) => {
      try { task.cancel(); } catch {}
    });
    pdfRenderTasks = [];
  };

  const updatePdfControls = () => {
    const ready = Boolean(pdfDocument);
    pdfZoomOut.disabled = !ready || pdfZoom <= 0.75;
    pdfZoomIn.disabled = !ready || pdfZoom >= 4;
    pdfZoomLabel.textContent = `${Math.round(pdfZoom * 100)}%`;
  };

  const updatePdfPanState = () => {
    pdfViewport?.classList.toggle('is-pannable', Boolean(pdfDocument && pdfZoom > 1.01));
  };

  const showPdfFallback = (url) => {
    if (!pdfFallback || !pdfPages) return;
    cancelPdfRenderTasks();
    pdfPages.replaceChildren();
    pdfPages.style.removeProperty('transform');
    pdfPages.style.removeProperty('transform-origin');
    pdfPages.hidden = true;
    pdfStatus.hidden = true;
    pdfFallback.src = url;
    pdfFallback.hidden = false;
  };

  const renderPdfDocument = async ({ anchorX, anchorY } = {}) => {
    if (!pdfDocument || !pdfReader.open || !pdfPages || !pdfViewport || !pdfStatus) return;
    const version = ++pdfRenderVersion;
    const doc = pdfDocument;
    const hadRenderedPages = pdfPages.children.length > 0;
    const focusX = Number.isFinite(anchorX) ? anchorX : pdfViewport.clientWidth / 2;
    const focusY = Number.isFinite(anchorY) ? anchorY : pdfViewport.clientHeight / 2;
    const previousX = hadRenderedPages
      ? (pdfViewport.scrollLeft + focusX) / Math.max(1, pdfViewport.scrollWidth)
      : 0;
    const previousY = hadRenderedPages
      ? (pdfViewport.scrollTop + focusY) / Math.max(1, pdfViewport.scrollHeight)
      : 0;
    cancelPdfRenderTasks();
    pdfPages.hidden = false;
    pdfFallback.hidden = true;
    pdfFallback.removeAttribute('src');
    pdfStatus.hidden = hadRenderedPages;
    pdfStatus.textContent = 'Rendering pages…';
    const availableWidth = Math.max(200, pdfViewport.clientWidth - 32);
    const maxCanvasEdge = 8192;
    const maxCanvasPixels = 16_000_000;
    const deviceDensity = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const stagedPages = document.createElement('div');

    try {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        if (version !== pdfRenderVersion || doc !== pdfDocument || !pdfReader.open) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: availableWidth / unscaled.width * pdfZoom });
        const maxDimension = Math.max(viewport.width, viewport.height);
        const pixelArea = Math.max(1, viewport.width * viewport.height);
        const density = Math.min(
          deviceDensity,
          maxCanvasEdge / Math.max(1, maxDimension),
          Math.sqrt(maxCanvasPixels / pixelArea)
        );
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = Math.max(1, Math.min(maxCanvasEdge, Math.ceil(viewport.width * density)));
        canvas.height = Math.max(1, Math.min(maxCanvasEdge, Math.ceil(viewport.height * density)));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${pageNumber} of ${doc.numPages} from ${pdfTitle.textContent}`);
        stagedPages.appendChild(canvas);
        const task = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0]
        });
        pdfRenderTasks.push(task);
        await task.promise;
        if (version !== pdfRenderVersion || doc !== pdfDocument || !pdfReader.open) return;
      }
      pdfPages.replaceChildren(...stagedPages.childNodes);
      pdfPages.style.removeProperty('transform');
      pdfPages.style.removeProperty('transform-origin');
      pdfStatus.hidden = true;
      pdfRenderTasks = [];
      updatePdfPanState();
      requestAnimationFrame(() => {
        if (version !== pdfRenderVersion || !pdfReader.open) return;
        pdfViewport.scrollLeft = previousX * pdfViewport.scrollWidth - focusX;
        pdfViewport.scrollTop = previousY * pdfViewport.scrollHeight - focusY;
      });
    } catch (error) {
      if (error?.name === 'RenderingCancelledException' || version !== pdfRenderVersion) return;
      showPdfFallback(pdfCurrentUrl);
    }
  };

  const openPdf = async (link) => {
    if (!pdfReader || !pdfPages || !pdfFallback || !pdfTitle || !pdfCloseButton || !pdfStatus || !pdfZoomLabel || typeof pdfReader.showModal !== 'function') return;
    const session = ++pdfSession;
    pdfReturnFocusTo = link;
    pageOverflowBeforePdf = document.body.style.overflow;
    pdfTitle.textContent = link.dataset.pdfTitle || link.querySelector('h3')?.textContent.trim() || 'Edit breakdown';
    if (pdfKicker) pdfKicker.textContent = link.dataset.pdfTitle === 'Demiken Resume' ? 'RESUME' : 'WHY THIS EDIT';
    pdfCurrentUrl = link.href;
    pdfZoom = 1;
    pdfDocument = null;
    pdfPages.replaceChildren();
    pdfPages.style.removeProperty('transform');
    pdfPages.style.removeProperty('transform-origin');
    pdfPages.hidden = false;
    pdfFallback.hidden = true;
    pdfFallback.removeAttribute('src');
    pdfStatus.hidden = false;
    pdfStatus.textContent = 'Loading your PDF…';
    updatePdfControls();
    document.body.style.overflow = 'hidden';
    pdfReader.showModal();
    pdfCloseButton.focus();
    try {
      const pdfjs = await import('./pdfjs/pdf.min.mjs');
      if (session !== pdfSession) return;
      pdfjs.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.min.mjs';
      pdfLoadingTask = pdfjs.getDocument(pdfCurrentUrl);
      const doc = await pdfLoadingTask.promise;
      if (session !== pdfSession) return;
      pdfDocument = doc;
      updatePdfControls();
      await renderPdfDocument();
    } catch {
      if (session !== pdfSession) return;
      showPdfFallback(pdfCurrentUrl);
    }
  };

  const closePdf = () => {
    if (!pdfReader?.open) return;

    pdfReader.close();
  };

  pdfReader?.addEventListener('close', () => {
    ++pdfSession;
    ++pdfRenderVersion;
    cancelPdfRenderTasks();
    pdfLoadingTask?.destroy().catch(() => {});
    pdfLoadingTask = null;
    pdfDocument = null;
    pdfPages?.replaceChildren();
    pdfPages?.style.removeProperty('transform');
    pdfPages?.style.removeProperty('transform-origin');
    pdfTouchPointers.clear();
    pdfPinch = null;
    pdfPanPointer = null;
    if (pdfPages) pdfPages.hidden = false;
    pdfFallback?.removeAttribute('src');
    if (pdfFallback) pdfFallback.hidden = true;
    pdfCurrentUrl = '';
    document.body.style.overflow = pageOverflowBeforePdf;
    if (pdfReturnFocusTo instanceof HTMLElement) pdfReturnFocusTo.focus();
    pdfReturnFocusTo = null;
  });

  pdfCloseButton?.addEventListener('click', closePdf);
  pdfReader?.addEventListener('click', (event) => {
    if (event.target === pdfReader) closePdf();
  });

  const changePdfZoom = (change) => {
    if (!pdfDocument) return;
    pdfZoom = Math.max(0.75, Math.min(4, Number((pdfZoom + change).toFixed(2))));
    updatePdfControls();
    renderPdfDocument();
  };
  pdfZoomOut?.addEventListener('click', () => changePdfZoom(-0.25));
  pdfZoomIn?.addEventListener('click', () => changePdfZoom(0.25));

  const pdfPointerMidpoint = (first, second) => ({
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  });
  const pdfPointerDistance = (first, second) => Math.hypot(second.x - first.x, second.y - first.y);

  pdfViewport?.addEventListener('pointerdown', (event) => {
    if (!pdfReader?.open || !pdfDocument || !event.target.closest?.('.pdf-page-canvas, #pdf-pages')) return;
    if (event.pointerType === 'touch') {
      const point = { id: event.pointerId, x: event.clientX, y: event.clientY };
      pdfTouchPointers.set(event.pointerId, point);
      try { pdfViewport.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();

      if (pdfTouchPointers.size === 2) {
        const [first, second] = [...pdfTouchPointers.values()];
        const midpoint = pdfPointerMidpoint(first, second);
        const pagesRect = pdfPages.getBoundingClientRect();
        pdfPinch = {
          ids: [first.id, second.id],
          startDistance: Math.max(1, pdfPointerDistance(first, second)),
          startZoom: pdfZoom,
          pageLeft: pagesRect.left,
          pageTop: pagesRect.top,
          contentX: midpoint.x - pagesRect.left,
          contentY: midpoint.y - pagesRect.top,
          lastMidpoint: midpoint
        };
        pdfPanPointer = null;
        pdfViewport.classList.remove('is-panning');
      } else if (pdfTouchPointers.size === 1) {
        pdfPanPointer = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: pdfViewport.scrollLeft,
          top: pdfViewport.scrollTop,
          pointerType: 'touch'
        };
        if (pdfZoom > 1.01) pdfViewport.classList.add('is-panning');
      }
      return;
    }

    if (pdfZoom <= 1.01 || !event.isPrimary || event.button !== 0) return;
    pdfPanPointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: pdfViewport.scrollLeft,
      top: pdfViewport.scrollTop,
      pointerType: event.pointerType
    };
    pdfViewport.classList.add('is-panning');
    pdfViewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  pdfViewport?.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' && pdfTouchPointers.has(event.pointerId)) {
      pdfTouchPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
      if (pdfPinch && pdfPinch.ids.every((id) => pdfTouchPointers.has(id))) {
        const [first, second] = pdfPinch.ids.map((id) => pdfTouchPointers.get(id));
        const midpoint = pdfPointerMidpoint(first, second);
        pdfPinch.lastMidpoint = midpoint;
        pdfZoom = Math.max(0.75, Math.min(4, pdfPinch.startZoom * pdfPointerDistance(first, second) / pdfPinch.startDistance));
        updatePdfControls();
        const scale = pdfZoom / pdfPinch.startZoom;
        const translateX = midpoint.x - pdfPinch.pageLeft - pdfPinch.contentX * scale;
        const translateY = midpoint.y - pdfPinch.pageTop - pdfPinch.contentY * scale;
        pdfPages.style.transformOrigin = '0 0';
        pdfPages.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
        event.preventDefault();
        return;
      }
      if (pdfPanPointer?.pointerType === 'touch' && event.pointerId === pdfPanPointer.id) {
        pdfViewport.scrollLeft = pdfPanPointer.left - (event.clientX - pdfPanPointer.x);
        pdfViewport.scrollTop = pdfPanPointer.top - (event.clientY - pdfPanPointer.y);
        event.preventDefault();
      }
      return;
    }
    if (!pdfPanPointer || event.pointerId !== pdfPanPointer.id) return;
    pdfViewport.scrollLeft = pdfPanPointer.left - (event.clientX - pdfPanPointer.x);
    pdfViewport.scrollTop = pdfPanPointer.top - (event.clientY - pdfPanPointer.y);
    event.preventDefault();
  });
  const endPdfPan = (event) => {
    if (event.pointerType === 'touch' && pdfTouchPointers.has(event.pointerId)) {
      pdfTouchPointers.delete(event.pointerId);
      if (pdfPinch && pdfPinch.ids.includes(event.pointerId)) {
        const midpoint = pdfPinch.lastMidpoint;
        const viewportRect = pdfViewport.getBoundingClientRect();
        pdfPinch = null;
        pdfPanPointer = null;
        pdfViewport.classList.remove('is-panning');
        renderPdfDocument({ anchorX: midpoint.x - viewportRect.left, anchorY: midpoint.y - viewportRect.top });
      } else if (pdfPanPointer?.pointerType === 'touch' && event.pointerId === pdfPanPointer.id) {
        pdfPanPointer = null;
        pdfViewport.classList.remove('is-panning');
      }
      return;
    }
    if (!pdfPanPointer || event.pointerId !== pdfPanPointer.id) return;
    pdfPanPointer = null;
    pdfViewport?.classList.remove('is-panning');
  };
  pdfViewport?.addEventListener('pointerup', endPdfPan);
  pdfViewport?.addEventListener('pointercancel', endPdfPan);
  pdfViewport?.addEventListener('lostpointercapture', endPdfPan);

  window.addEventListener('resize', () => {
    if (!pdfReader?.open || !pdfDocument) return;
    clearTimeout(pdfResizeTimer);
    pdfResizeTimer = setTimeout(renderPdfDocument, 150);
  });

  fullscreenButton?.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButton);

  document.addEventListener('click', (event) => {
    const pdfLink = event.target.closest?.('.answers-video-card, .pdf-reader-link');
    if (pdfLink) {
      event.preventDefault();
      openPdf(pdfLink);
      return;
    }

    const link = event.target.closest?.('[data-drive-id]');
    if (link) {
      event.preventDefault();
      openVideo(link);
      return;
    }

    if (event.target === closeButton) {
      closeVideo();
      return;
    }

    if (event.target === modal) closeVideo();
  });

  document.addEventListener('keydown', (event) => {
    if (!modal?.classList.contains('open')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeVideo();
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const header = document.querySelector('.top');
  let scrollFrame = 0;
  const updateHeader = () => {
    scrollFrame = 0;
    header?.classList.toggle('s', window.scrollY > 24);
  };

  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(updateHeader);
  }, { passive: true });
  updateHeader();

  const selectVisibleVideo = () => {
    if (modal?.classList.contains('open') || !hasUserScrolled) return;
    const mostVisible = videoLinks
      .map((link) => ({ link, ratio: videoVisibility.get(link) || 0 }))
      .reduce((best, current) => current.ratio > best.ratio ? current : best, { link: null, ratio: 0 });
    if (!mostVisible.link || mostVisible.ratio < 0.45) {
      if (activeVideoLink) stopCardPlayback();
      return;
    }
    if (mostVisible.link !== activeVideoLink) mountVideo(mostVisible.link, mostVisible.link);
  };

  const enableAutoplayAfterScrollInput = () => {
    if (hasUserScrolled) return;
    hasUserScrolled = true;
    selectVisibleVideo();
  };
  window.addEventListener('wheel', enableAutoplayAfterScrollInput, { passive: true });
  window.addEventListener('touchmove', enableAutoplayAfterScrollInput, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) return;
    if (event.target instanceof HTMLElement && event.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;
    enableAutoplayAfterScrollInput();
  });

  if (frame && videoModalInner && videoLinks.length && 'IntersectionObserver' in window) {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => videoVisibility.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0));
      selectVisibleVideo();
    }, { threshold: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1], rootMargin: '-8% 0px -8% 0px' });
    videoLinks.forEach((link) => videoObserver.observe(link));
  }

  window.addEventListener('resize', () => {
    if (activeVideoLink && frame?.parentElement === activeVideoLink && !modal?.classList.contains('open')) {
      sizeInlineVideo(activeVideoLink);
    }
  });

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealTargets = [...document.querySelectorAll('.card, .work-step, .answers-video-card')];
  let observer = null;

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    revealTargets.forEach((element) => element.classList.add('will-reveal'));
    observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        currentObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    revealTargets.forEach((element) => observer.observe(element));
  }

  const syncMotionPreference = (event) => {
    if (event.matches) {
      observer?.disconnect();
      revealTargets.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    if (!observer && 'IntersectionObserver' in window) {
      revealTargets.forEach((element) => {
        element.classList.add('will-reveal');
        element.classList.remove('is-visible');
      });
      observer = new IntersectionObserver((entries, currentObserver) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          currentObserver.unobserve(entry.target);
        });
      }, { threshold: 0.08 });
      revealTargets.forEach((element) => observer.observe(element));
    }
  };

  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncMotionPreference);
  else reducedMotion.addListener(syncMotionPreference);
})();

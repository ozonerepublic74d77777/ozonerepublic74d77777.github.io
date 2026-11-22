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

  const closeVideo = ({ restoreFocus = true } = {}) => {
    if (!modal || !frame || !modal.classList.contains('open')) return;

    if (document.fullscreenElement && modal.contains(document.fullscreenElement)) {
      document.exitFullscreen?.().catch(() => {});
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    frame.removeAttribute('src');
    document.body.style.overflow = '';

    if (restoreFocus && returnFocusTo instanceof HTMLElement) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
  };

  const openVideo = (link) => {
    if (!modal || !frame || !closeButton) return;

    returnFocusTo = link;
    frame.src = `https://drive.google.com/file/d/${encodeURIComponent(link.dataset.driveId)}/preview?autoplay=1`;
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
    pdfZoomIn.disabled = !ready || pdfZoom >= 2.5;
    pdfZoomLabel.textContent = `${Math.round(pdfZoom * 100)}%`;
  };

  const showPdfFallback = (url) => {
    if (!pdfFallback || !pdfPages) return;
    cancelPdfRenderTasks();
    pdfPages.replaceChildren();
    pdfPages.hidden = true;
    pdfStatus.hidden = true;
    pdfFallback.src = url;
    pdfFallback.hidden = false;
  };

  const renderPdfDocument = async () => {
    if (!pdfDocument || !pdfReader.open || !pdfPages || !pdfViewport || !pdfStatus) return;
    const version = ++pdfRenderVersion;
    const doc = pdfDocument;
    cancelPdfRenderTasks();
    pdfPages.replaceChildren();
    pdfPages.hidden = false;
    pdfFallback.hidden = true;
    pdfFallback.removeAttribute('src');
    pdfStatus.hidden = false;
    pdfStatus.textContent = 'Rendering pages…';
    const availableWidth = Math.max(200, pdfViewport.clientWidth - 32);
    const density = Math.min(window.devicePixelRatio || 1, 2);

    try {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        if (version !== pdfRenderVersion || doc !== pdfDocument || !pdfReader.open) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: availableWidth / unscaled.width * pdfZoom });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = Math.ceil(viewport.width * density);
        canvas.height = Math.ceil(viewport.height * density);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${pageNumber} of ${doc.numPages} from ${pdfTitle.textContent}`);
        pdfPages.appendChild(canvas);
        const task = page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: density === 1 ? null : [density, 0, 0, density, 0, 0]
        });
        pdfRenderTasks.push(task);
        await task.promise;
        if (version !== pdfRenderVersion || doc !== pdfDocument || !pdfReader.open) return;
      }
      pdfStatus.hidden = true;
      pdfRenderTasks = [];
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
    const scrollProgress = pdfViewport.scrollTop / Math.max(1, pdfViewport.scrollHeight);
    pdfZoom = Math.max(0.75, Math.min(2.5, Number((pdfZoom + change).toFixed(2))));
    updatePdfControls();
    renderPdfDocument().then(() => {
      if (pdfReader?.open) pdfViewport.scrollTop = scrollProgress * pdfViewport.scrollHeight;
    });
  };
  pdfZoomOut?.addEventListener('click', () => changePdfZoom(-0.25));
  pdfZoomIn?.addEventListener('click', () => changePdfZoom(0.25));
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

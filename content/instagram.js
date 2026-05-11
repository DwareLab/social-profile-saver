(function () {
  const BUTTON_CLASS = 'sps-save-btn';
  const PROCESSED_ATTR = 'data-sps-processed';

  function createSaveButton(profileData) {
    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.textContent = 'Save to CRM';
    btn.setAttribute(PROCESSED_ATTR, 'true');
    Object.assign(btn.style, {
      background: '#2563eb',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      padding: '6px 14px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      marginLeft: '8px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      transition: 'all 0.2s ease',
      lineHeight: '1.4'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#1d4ed8';
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.disabled) btn.style.background = '#2563eb';
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.style.background = '#6b7280';

      chrome.runtime.sendMessage({ type: 'SAVE_TO_GHL', data: profileData }, (response) => {
        if (response && response.success) {
          btn.textContent = 'Saved';
          btn.style.background = '#16a34a';
        } else {
          btn.textContent = 'Failed';
          btn.style.background = '#dc2626';
          btn.title = response?.error || 'Unknown error';
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Retry';
            btn.style.background = '#2563eb';
            btn.title = '';
          }, 3000);
        }
      });
    });

    return btn;
  }

  function scrapeCurrentProfile() {
    const data = { platform: 'instagram', url: window.location.href };

    // Use main header (not nav header) for profile data
    const header = document.querySelector('main header') || document.querySelector('header section')?.closest('header') || document.querySelector('header');
    if (!header) return data;

    // Username from h2 (can be in header or page-wide)
    const h2 = header.querySelector('h2') || document.querySelector('main h2');
    if (h2) data.username = h2.innerText.trim();

    // All spans in header for extraction
    const headerSpans = Array.from(header.querySelectorAll('span'))
      .map(s => s.innerText?.trim())
      .filter(t => t && t.length > 0 && t.length < 300);
    const uniqueSpans = [...new Set(headerSpans)];

    // Display name: look for a span that is not username, not stats, comes early
    for (const span of uniqueSpans) {
      if (span === data.username) continue;
      if (/\d/.test(span) && (span.includes('posts') || span.includes('followers') || span.includes('following'))) continue;
      if (/^\d+$/.test(span)) continue;
      if (span === 'Followed by' || span.startsWith('Followed by')) continue;
      if (span.includes('more') && span.length < 10) continue;
      if (span.length > 2 && span.length < 50 && !span.includes('\n')) {
        data.name = span;
        break;
      }
    }

    // Profile picture - look for img with "profile picture" alt text, or first large img in header
    const allImgs = Array.from(header.querySelectorAll('img'));
    const profileImg = allImgs.find(i => i.alt && i.alt.includes('profile picture')) ||
                       allImgs.find(i => i.width >= 60 || i.height >= 60) ||
                       allImgs[0];
    if (profileImg && profileImg.src) data.profile_picture_url = profileImg.src;

    // Stats: posts, followers, following
    for (const span of uniqueSpans) {
      if (/\d/.test(span)) {
        if (span.includes('posts') && !data.posts_count) data.posts_count = span;
        else if (span.includes('followers') && !data.followers) data.followers = span;
        else if (span.includes('following') && !data.following) data.following = span;
      }
    }

    // Bio: look for multi-line or longer text that is the bio description
    const knownTexts = new Set([data.username, data.name, data.posts_count, data.followers, data.following]);
    for (const span of uniqueSpans) {
      if (knownTexts.has(span)) continue;
      if (/^\d+$/.test(span)) continue;
      if (span.includes('posts') || span.includes('followers') || span.includes('following')) continue;
      if (span.startsWith('Followed by')) continue;
      if (span === 'more' || span === '... \nmore') continue;
      if (span.length > 15) {
        // Clean up trailing "... more"
        data.bio = span.replace(/\.\.\.\s*\nmore$/, '').trim();
        break;
      }
    }

    // Verified badge
    const verified = header.querySelector('svg[aria-label="Verified"]') || header.querySelector('span[title="Verified"]');
    data.is_verified = !!verified;

    // External link - from l.instagram.com links
    const externalLinks = Array.from(header.querySelectorAll('a')).filter(a =>
      a.href && (a.href.includes('l.instagram.com') || (a.rel && a.rel.includes('nofollow')))
    );
    if (externalLinks.length > 0) {
      data.external_url = externalLinks[0].innerText?.trim();
    }

    // Mutual followers
    const mutualSpan = uniqueSpans.find(t => t.startsWith('Followed by'));
    if (mutualSpan) data.mutual_followers = mutualSpan;

    return data;
  }

  function extractProfileFromFeedPost(postElement) {
    const data = { platform: 'instagram' };

    const authorLink = postElement.querySelector('header a[href]');
    if (!authorLink) return null;

    const href = authorLink.href;
    if (!href || href.includes('/p/') || href.includes('/reel/') ||
        href.includes('/explore/') || href.includes('/stories/')) return null;

    const username = href.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
    if (!username || username.length < 2 || username === 'explore') return null;

    data.url = `https://www.instagram.com/${username}/`;
    data.username = username;

    const nameEl = authorLink.querySelector('span') || authorLink;
    const displayText = nameEl.innerText?.trim();
    if (displayText && displayText !== username) {
      data.name = displayText;
    }

    const img = postElement.querySelector('header img');
    if (img) data.profile_picture_url = img.src;

    return data;
  }

  function isProfilePage() {
    const path = window.location.pathname;
    if (path === '/' || path.startsWith('/p/') || path.startsWith('/reel/') ||
        path.startsWith('/explore/') || path.startsWith('/stories/') ||
        path.startsWith('/direct/') || path.startsWith('/accounts/')) return false;

    const h2 = document.querySelector('main h2') || document.querySelector('header h2');
    return !!h2;
  }

  function injectProfilePageButton() {
    if (!isProfilePage()) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const header = document.querySelector('header');
    if (!header) return;

    const profileData = scrapeCurrentProfile();
    if (!profileData.username) return;

    const btn = createSaveButton(profileData);

    const actionBtns = header.querySelector('section > div:nth-child(2)') ||
                       header.querySelector('section');
    if (actionBtns) {
      actionBtns.appendChild(btn);
    }
  }

  function injectFeedButtons() {
    const feedPosts = document.querySelectorAll('article');

    feedPosts.forEach(post => {
      if (post.getAttribute(PROCESSED_ATTR)) return;
      post.setAttribute(PROCESSED_ATTR, 'true');

      const profileData = extractProfileFromFeedPost(post);
      if (!profileData) return;

      const headerEl = post.querySelector('header');
      if (!headerEl) return;
      if (headerEl.querySelector(`.${BUTTON_CLASS}`)) return;

      const btn = createSaveButton(profileData);
      btn.style.fontSize = '11px';
      btn.style.padding = '3px 10px';

      headerEl.appendChild(btn);
    });
  }

  function init() {
    injectProfilePageButton();
    injectFeedButtons();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PROFILE_DATA') {
      if (isProfilePage()) {
        const data = scrapeCurrentProfile();
        sendResponse({ data });
      } else {
        sendResponse({ data: null });
      }
    }
  });

  const observer = new MutationObserver(() => {
    init();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setTimeout(init, 2000);
  setTimeout(init, 5000);
})();

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
      lineHeight: '1.4',
      whiteSpace: 'nowrap'
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
    const data = { platform: 'linkedin', url: window.location.href };

    const main = document.querySelector('main');
    if (!main) return data;

    const allSections = Array.from(main.querySelectorAll('section'));
    if (!allSections.length) return data;

    const topSection = allSections[0];
    if (topSection) {
      // Name from h1, fallback to first text line
      const h1 = topSection.querySelector('h1') || document.querySelector('main h1');
      if (h1) data.name = h1.innerText.trim();

      // Profile picture
      const imgs = Array.from(topSection.querySelectorAll('img'));
      const profileImg = imgs.find(i => (i.src || '').includes('profile-displayphoto'));
      if (profileImg) data.profile_picture_url = profileImg.src;

      // Parse top section by text lines for headline, location, followers
      const topText = topSection.innerText || '';
      const lines = topText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // Fallback: if h1 didn't give us a name, use the first non-trivial line
      if (!data.name && lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.length > 1 && firstLine.length < 60) {
          data.name = firstLine;
        }
      }

      const skipTexts = new Set([
        data.name, 'Contact info', 'Follow', 'Message', 'Connect',
        'More', 'Open to', 'Visit my website', 'Profile enhanced with Premium',
        'He/Him', 'She/Her', 'They/Them'
      ]);

      for (const line of lines) {
        if (skipTexts.has(line)) continue;

        // Connection degree: "· 2nd" or "· 3rd"
        if (/^\u00B7?\s*\d+(st|nd|rd|th)$/.test(line) || line === '· 2nd' || line === '· 3rd' || line === '· 1st') {
          data.connection_degree = line.replace(/^\u00B7\s*/, '').trim();
          continue;
        }

        // Followers: contains "followers" keyword
        if (line.includes('followers') && !data.followers) {
          data.followers = line;
          continue;
        }

        // Connections (skip bare "connections" word, only capture with a number)
        if (line.includes('connections') && /\d/.test(line) && !data.connections) {
          data.connections = line;
          continue;
        }
        if (line === 'connections' || line === '500+') continue;

        // Mutual connections
        if (line.includes('mutual connection') && !data.mutual_connections) {
          data.mutual_connections = line;
          continue;
        }

        // Headline: first long text (>15 chars) that is not the name
        if (!data.headline && line !== data.name && line.length > 15 &&
            !line.includes('followers') && !line.includes('connections') &&
            !line.includes('mutual') && !line.startsWith('\u00B7') &&
            line !== '·') {
          data.headline = line;
          continue;
        }

        // Location: comes after headline, is shorter, looks like a place
        if (data.headline && !data.location && line.length > 3 && line.length < 60 &&
            line !== data.headline && !line.includes('followers') &&
            !line.includes('connections') && !line.includes('mutual') &&
            !line.startsWith('\u00B7') && line !== '·' &&
            !skipTexts.has(line) && !line.includes('500+')) {
          data.location = line;
          continue;
        }
      }

      // Current company from company link
      const companyLink = topSection.querySelector('a[href*="/company/"]');
      if (companyLink) {
        data.current_company = companyLink.innerText?.trim();
      }
    }

    // About section
    for (const section of allSections) {
      const text = section.innerText || '';
      if (text.startsWith('About\n')) {
        const aboutContent = text.substring('About\n'.length).trim()
          .replace(/\s*\u2026\s*more\s*$/, '').replace(/\s*Show less\s*$/, '');
        if (aboutContent.length > 0) data.about = aboutContent;
        break;
      }
    }

    // Experience section
    for (const section of allSections) {
      const text = section.innerText || '';
      if (text.startsWith('Experience\n')) {
        const expContent = text.substring('Experience\n'.length).trim();
        const expLines = expContent.split('\n').filter(l => l.trim().length > 0);
        const experiences = [];
        let current = null;

        for (const line of expLines) {
          const trimmed = line.trim();
          if (trimmed === 'Show all experiences' || trimmed.startsWith('Show all')) break;
          if (!current) {
            current = { title: trimmed };
          } else if (!current.company && trimmed.length > 1) {
            current.company = trimmed;
          } else if (!current.duration && (trimmed.includes('yr') || trimmed.includes('mo') || trimmed.includes('Present'))) {
            current.duration = trimmed;
          } else if (!current.location && trimmed.includes(',')) {
            current.location = trimmed;
            experiences.push(current);
            current = null;
          } else if (trimmed.length > 1) {
            if (current.company) {
              experiences.push(current);
              current = { title: trimmed };
            }
          }
        }
        if (current && current.title) experiences.push(current);
        if (experiences.length) data.experience = experiences.slice(0, 5);
        break;
      }
    }

    // Education section
    for (const section of allSections) {
      const text = section.innerText || '';
      if (text.startsWith('Education\n')) {
        const eduContent = text.substring('Education\n'.length).trim();
        const eduLines = eduContent.split('\n').filter(l => l.trim().length > 0);
        const educations = [];
        let current = null;

        for (const line of eduLines) {
          const trimmed = line.trim();
          if (trimmed === 'Show all education' || trimmed.startsWith('Show all')) break;
          if (!current) {
            current = { school: trimmed };
          } else if (!current.degree && trimmed.length > 1) {
            current.degree = trimmed;
          } else if (!current.years && trimmed.match(/\d{4}/)) {
            current.years = trimmed;
            educations.push(current);
            current = null;
          } else if (trimmed.length > 1) {
            if (current.school) {
              educations.push(current);
              current = { school: trimmed };
            }
          }
        }
        if (current && current.school) educations.push(current);
        if (educations.length) data.education = educations.slice(0, 5);
        break;
      }
    }

    return data;
  }

  function extractProfileFromFeedPost(postElement) {
    const data = { platform: 'linkedin' };

    const authorLink = postElement.querySelector('a.app-aware-link[href*="/in/"]') ||
                       postElement.querySelector('a[href*="linkedin.com/in/"]');
    if (!authorLink) return null;

    const href = authorLink.href;
    if (!href) return null;

    data.url = href.split('?')[0];

    const nameSpan = authorLink.querySelector('span[dir="ltr"] span, span.feed-shared-actor__name');
    if (nameSpan) {
      data.name = nameSpan.innerText?.trim();
    } else {
      data.name = authorLink.innerText?.trim()?.split('\n')[0];
    }
    if (!data.name || data.name.length < 2) return null;

    const subtitleEl = postElement.querySelector('.feed-shared-actor__description, .update-components-actor__description');
    if (subtitleEl) data.headline = subtitleEl.innerText?.trim()?.split('\n')[0];

    const img = postElement.querySelector('img.feed-shared-actor__avatar-image, img.EntityPhoto-circle-3, img[src*="profile-displayphoto"]');
    if (img) data.profile_picture_url = img.src;

    return data;
  }

  function isProfilePage() {
    return window.location.pathname.startsWith('/in/');
  }

  function injectProfilePageButton() {
    if (!isProfilePage()) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const profileData = scrapeCurrentProfile();
    if (!profileData.name) return;

    const btn = createSaveButton(profileData);

    const topCard = document.querySelector('section .pv-top-card-v2-ctas, section .pvs-profile-actions');
    if (topCard) {
      topCard.appendChild(btn);
      return;
    }

    const h1 = document.querySelector('main section h1');
    if (h1) {
      const parent = h1.parentElement;
      if (parent) {
        parent.style.display = 'flex';
        parent.style.alignItems = 'center';
        parent.style.flexWrap = 'wrap';
        parent.appendChild(btn);
      }
    }
  }

  function injectFeedButtons() {
    const feedPosts = document.querySelectorAll('.feed-shared-update-v2, [data-urn*="activity"]');

    feedPosts.forEach(post => {
      if (post.getAttribute(PROCESSED_ATTR)) return;
      post.setAttribute(PROCESSED_ATTR, 'true');

      const profileData = extractProfileFromFeedPost(post);
      if (!profileData) return;

      const actorContainer = post.querySelector('.feed-shared-actor__container, .update-components-actor');
      if (!actorContainer) return;
      if (actorContainer.querySelector(`.${BUTTON_CLASS}`)) return;

      const btn = createSaveButton(profileData);
      btn.style.fontSize = '11px';
      btn.style.padding = '3px 10px';
      btn.style.marginTop = '4px';

      actorContainer.appendChild(btn);
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

  let lastUrl = window.location.href;

  function onNavigate() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
    setTimeout(init, 800);
    setTimeout(init, 2000);
    setTimeout(init, 4000);
  }

  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      onNavigate();
    } else {
      init();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('popstate', () => {
    lastUrl = window.location.href;
    onNavigate();
  });

  setTimeout(init, 3000);
  setTimeout(init, 6000);
})();

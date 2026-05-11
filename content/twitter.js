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
      borderRadius: '9999px',
      padding: '6px 16px',
      fontSize: '13px',
      fontWeight: '700',
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
    const data = { platform: 'twitter', url: window.location.href };

    const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryCol) return data;

    const userNameEl = primaryCol.querySelector('[data-testid="UserName"]');
    if (userNameEl) {
      const spans = Array.from(userNameEl.querySelectorAll('span'))
        .map(s => s.innerText?.trim())
        .filter(t => t && t.length > 0);

      const handle = spans.find(s => s.startsWith('@'));
      if (handle) data.username = handle.replace('@', '');

      const displayName = spans.find(s => !s.startsWith('@') && s.length > 1 && s !== 'Follow' && s !== 'Following');
      if (displayName) data.name = displayName;
    }

    const avatarImg = primaryCol.querySelector('[data-testid="UserAvatar"] img') ||
                      primaryCol.querySelector('a[href$="/photo"] img');
    if (avatarImg && avatarImg.src) {
      data.profile_picture_url = avatarImg.src.replace('_normal', '_200x200').replace('_bigger', '_200x200');
    }

    const bioEl = primaryCol.querySelector('[data-testid="UserDescription"]');
    if (bioEl) data.bio = bioEl.innerText?.trim();

    const headerItems = primaryCol.querySelector('[data-testid="UserProfileHeader_Items"]');
    if (headerItems) {
      const links = Array.from(headerItems.querySelectorAll('a'));
      for (const link of links) {
        const text = link.innerText?.trim();
        if (text && !text.startsWith('Joined') && text.length > 2) {
          data.website = text;
          break;
        }
      }

      const itemText = headerItems.innerText || '';
      const joinedMatch = itemText.match(/Joined\s+(.+)/);
      if (joinedMatch) data.joined = joinedMatch[1].trim();

      const locationSpan = headerItems.querySelector('span[data-testid="UserLocation"]');
      if (locationSpan) data.location = locationSpan.innerText?.trim();
    }

    const followersLink = primaryCol.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');
    if (followersLink) {
      const text = followersLink.innerText?.trim();
      const match = text?.match(/([\d,.]+[KMB]?)\s*Followers/i);
      if (match) data.followers = match[1];
      else data.followers = text;
    }

    const followingLink = primaryCol.querySelector('a[href$="/following"]');
    if (followingLink) {
      const text = followingLink.innerText?.trim();
      const match = text?.match(/([\d,.]+[KMB]?)\s*Following/i);
      if (match) data.following = match[1];
      else data.following = text;
    }

    const verified = primaryCol.querySelector('[data-testid="icon-verified"], svg[aria-label*="Verified"]');
    data.is_verified = !!verified;

    return data;
  }

  function extractProfileFromTweet(tweetEl) {
    const data = { platform: 'twitter' };

    const authorLink = tweetEl.querySelector('[data-testid="User-Name"] a[role="link"]');
    if (!authorLink) return null;

    const href = authorLink.getAttribute('href');
    if (!href || href === '/') return null;

    const username = href.replace(/^\//, '').split('/')[0];
    if (!username || username.length < 1) return null;

    data.url = `https://x.com/${username}`;
    data.username = username;

    const nameSpan = authorLink.querySelector('span span') || authorLink.querySelector('span');
    if (nameSpan) {
      const name = nameSpan.innerText?.trim();
      if (name && name !== username && !name.startsWith('@')) {
        data.name = name;
      }
    }

    const avatarImg = tweetEl.querySelector('[data-testid="Tweet-User-Avatar"] img');
    if (avatarImg && avatarImg.src) {
      data.profile_picture_url = avatarImg.src.replace('_normal', '_200x200').replace('_bigger', '_200x200');
    }

    return data;
  }

  function isProfilePage() {
    const path = window.location.pathname;
    if (path === '/' || path === '/home' || path === '/explore' ||
        path === '/notifications' || path === '/messages' ||
        path.startsWith('/i/') || path.startsWith('/search') ||
        path.startsWith('/settings')) return false;

    const segments = path.split('/').filter(Boolean);
    if (segments.length > 1 && segments[1] !== 'with_replies' &&
        segments[1] !== 'media' && segments[1] !== 'likes') return false;

    const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
    const userName = primaryCol?.querySelector('[data-testid="UserName"]');
    return !!userName;
  }

  function injectProfilePageButton() {
    if (!isProfilePage()) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryCol) return;

    const profileData = scrapeCurrentProfile();
    if (!profileData.username) return;

    const btn = createSaveButton(profileData);

    const userNameEl = primaryCol.querySelector('[data-testid="UserName"]');
    if (userNameEl) {
      const container = userNameEl.closest('div');
      if (container) {
        btn.style.marginTop = '8px';
        container.parentElement.insertBefore(btn, container.nextSibling);
      }
    }
  }

  function injectFeedButtons() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');

    tweets.forEach(tweet => {
      if (tweet.getAttribute(PROCESSED_ATTR)) return;
      tweet.setAttribute(PROCESSED_ATTR, 'true');

      const profileData = extractProfileFromTweet(tweet);
      if (!profileData) return;

      const userNameSection = tweet.querySelector('[data-testid="User-Name"]');
      if (!userNameSection) return;
      if (userNameSection.querySelector(`.${BUTTON_CLASS}`)) return;

      const btn = createSaveButton(profileData);
      btn.style.fontSize = '11px';
      btn.style.padding = '2px 10px';
      btn.style.marginLeft = '6px';

      userNameSection.appendChild(btn);
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

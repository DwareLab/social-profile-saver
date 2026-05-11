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
    const data = { platform: 'facebook', url: window.location.href };
    const mainDiv = document.querySelector('div[role="main"]');
    if (!mainDiv) return data;

    const FB_NAV_NAMES = new Set([
      'home', 'facebook', 'watch', 'marketplace', 'gaming',
      'groups', 'friends', 'events', 'pages', 'notifications',
      'menu', 'search', 'messenger', 'bookmarks', 'memories'
    ]);
    const h1 = mainDiv.querySelector('h1') || document.querySelector('div[role="main"] h1');
    if (h1) {
      const h1Text = h1.innerText.trim();
      if (h1Text && !FB_NAV_NAMES.has(h1Text.toLowerCase())) {
        data.name = h1Text;
      }
    }

    // Profile picture: first SVG image INSIDE main (largest one, usually 168px)
    const mainSvgImages = mainDiv.querySelectorAll('svg image, image[preserveAspectRatio]');
    if (mainSvgImages.length > 0) {
      const href = mainSvgImages[0].getAttribute('xlink:href') || mainSvgImages[0].getAttribute('href');
      if (href) data.profile_picture_url = href;
    }

    // Get all span texts from main for parsing
    const allSpans = Array.from(mainDiv.querySelectorAll('span'));
    const uniqueTexts = [...new Set(
      allSpans.map(s => s.innerText?.trim()).filter(t => t && t.length > 2 && t.length < 300)
    )];

    // Followers/following - check combined format first: "5.9K followers . 7.4K following"
    const combinedFollowers = uniqueTexts.find(t => t.includes('followers') && t.includes('following'));
    if (combinedFollowers) {
      data.followers_following = combinedFollowers;
      const followerMatch = combinedFollowers.match(/([\d.,KMB]+)\s*followers/i);
      const followingMatch = combinedFollowers.match(/([\d.,KMB]+)\s*following/i);
      if (followerMatch) data.followers = followerMatch[1] + ' followers';
      if (followingMatch) data.following = followingMatch[1] + ' following';
    } else {
      const allLinks = Array.from(document.querySelectorAll('a'));
      const followerLink = allLinks.find(a => a.href && a.href.includes('followers') && a.innerText);
      if (followerLink) data.followers = followerLink.innerText.trim();
      const followingLink = allLinks.find(a => a.href && a.href.includes('following') && a.innerText);
      if (followingLink) data.following = followingLink.innerText.trim();
    }

    // Friends count - look for "X mutual friends" or a count with "friends"
    const mutualFriends = uniqueTexts.find(t => t.includes('mutual friends'));
    if (mutualFriends) data.mutual_friends = mutualFriends;

    // Intro data extraction
    const introData = {};

    // Bio: look for the descriptive text (usually a long span that describes what the person does)
    const bioCandidate = uniqueTexts.find(t =>
      t.length > 20 && t.length < 200 &&
      t !== data.name &&
      !t.includes('followers') && !t.includes('following') &&
      !t.includes('mutual friends') && !t.includes('See all') &&
      !t.includes('Privacy') && !t.includes('Terms') &&
      !t.includes('updated his') && !t.includes('updated her') &&
      !t.includes('\n') &&
      !/^(Friends|Message|Search|Posts|Photos|Videos|About|More)$/.test(t)
    );
    if (bioCandidate) introData.bio = bioCandidate;

    // Work: look for role/company patterns
    const workPatterns = [/works? at/i, /founder/i, /ceo/i, /coo/i, /cto/i, /director/i, /manager/i, /engineer/i, /consultant/i, /former/i, /owner/i, /president/i];
    const work = uniqueTexts.filter(t => workPatterns.some(p => p.test(t)) && t.length < 100);
    if (work.length) introData.work = work;

    // Also look for company name after "Digital creator" or role
    const roleSpan = uniqueTexts.find(t => t.includes('\n') && (t.includes('Digital creator') || t.includes('Entrepreneur') || workPatterns.some(p => p.test(t))));
    if (roleSpan) {
      const parts = roleSpan.split('\n').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length > 1) {
        introData.role = parts[0];
        introData.company = parts[1];
      }
    }

    // Education
    const educationPatterns = [/studi/i, /went to/i, /school/i, /university/i, /college/i];
    const education = uniqueTexts.filter(t => educationPatterns.some(p => p.test(t)) && t.length < 100);
    if (education.length) introData.education = education;

    // Location
    const locationPatterns = [/lives? in/i, /from /i, /moved to/i];
    const locations = uniqueTexts.filter(t => locationPatterns.some(p => p.test(t)) && t.length < 100);
    if (locations.length) introData.locations = locations;

    // Relationship
    const relationshipPatterns = [/married/i, /single/i, /in a relationship/i, /engaged/i, /divorced/i];
    const relationship = uniqueTexts.find(t => relationshipPatterns.some(p => p.test(t)));
    if (relationship) introData.relationship = relationship;

    if (Object.keys(introData).length) data.intro = introData;

    // Website links: get actual domain links (filter out Instagram/TikTok/social handles)
    const allLinks = Array.from(document.querySelectorAll('a'));
    const externalLinks = allLinks
      .filter(a => a.href && a.href.includes('l.facebook.com/l.php') && !a.href.includes('facebook.com/help'))
      .map(a => a.innerText?.trim())
      .filter(t => t && t.length > 3);

    // Prefer actual domain links over social handles
    const domainLinks = externalLinks.filter(t => t.includes('.') && !t.startsWith('@'));
    const socialHandles = externalLinks.filter(t => !t.includes('.') || t.startsWith('@'));

    if (domainLinks.length > 0) {
      data.website = domainLinks[0];
      if (domainLinks.length > 1) data.additional_links = domainLinks.slice(1);
    }
    if (socialHandles.length > 0) {
      data.social_handles = socialHandles;
    }

    // Also check the Links section in spans
    const linksIndex = uniqueTexts.indexOf('Links');
    if (linksIndex !== -1) {
      const linksText = uniqueTexts[linksIndex + 1];
      if (linksText && linksText.includes('.')) {
        const links = linksText.split(/\s*·\s*/).map(l => l.trim()).filter(l => l.includes('.'));
        if (links.length > 0 && !data.website) data.website = links[0];
        if (links.length > 1 && !data.additional_links) data.additional_links = links.slice(1);
      }
    }

    return data;
  }

  function extractProfileFromFeedPost(postElement) {
    const data = { platform: 'facebook' };

    const authorLink = postElement.querySelector('a[role="link"][href*="facebook.com/"]') ||
                       postElement.querySelector('h2 a, h3 a, h4 a');
    if (!authorLink) return null;

    const href = authorLink.href;
    if (!href || href.includes('/groups/') || href.includes('/events/') ||
        href.includes('/photo') || href.includes('/reel/') || href.includes('/hashtag/')) return null;

    data.url = href.split('?')[0];
    data.name = authorLink.innerText?.trim();
    if (!data.name || data.name.length < 2) return null;

    // Get profile picture from the post author area (within main content)
    const postSvgImg = postElement.querySelector('svg image, image[preserveAspectRatio]');
    if (postSvgImg) {
      const picHref = postSvgImg.getAttribute('xlink:href') || postSvgImg.getAttribute('href');
      if (picHref) data.profile_picture_url = picHref;
    }

    return data;
  }

  function isProfilePage() {
    const path = window.location.pathname;
    const isGroupUserProfile = /^\/groups\/[^/]+\/user\/\d+/.test(path);
    if (path === '/' || path === '/home.php' ||
        (path.startsWith('/groups/') && !isGroupUserProfile) ||
        path.startsWith('/events/') || path.startsWith('/marketplace/') ||
        path.startsWith('/watch') || path.startsWith('/gaming/') ||
        path.startsWith('/search/') || path.startsWith('/friends/') ||
        path.startsWith('/messages/') || path.startsWith('/notifications/') ||
        path.startsWith('/stories/') || path.startsWith('/reels/')) return false;

    const mainDiv = document.querySelector('div[role="main"]');
    if (!mainDiv) return false;

    const h1 = mainDiv.querySelector('h1');
    if (!h1) return false;

    const text = h1.innerText.trim().toLowerCase();
    const navNames = ['home', 'facebook', 'watch', 'marketplace', 'gaming',
      'groups', 'friends', 'events', 'pages', 'notifications', 'menu', 'search'];
    return !navNames.includes(text);
  }

  function injectProfilePageButton() {
    if (!isProfilePage()) return;
    if (document.querySelector(`.${BUTTON_CLASS}`)) return;

    const h1 = document.querySelector('h1');
    if (!h1) return;

    const profileData = scrapeCurrentProfile();
    if (!profileData.name) return;

    const btn = createSaveButton(profileData);
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.verticalAlign = 'middle';

    const parent = h1.parentElement;
    if (parent) {
      parent.style.display = 'flex';
      parent.style.alignItems = 'center';
      parent.style.flexWrap = 'wrap';
      parent.appendChild(btn);
    }
  }

  function injectFeedButtons() {
    const feedPosts = document.querySelectorAll('[role="article"], [data-ad-comet-preview="message"]');

    feedPosts.forEach(post => {
      if (post.getAttribute(PROCESSED_ATTR)) return;
      post.setAttribute(PROCESSED_ATTR, 'true');

      const profileData = extractProfileFromFeedPost(post);
      if (!profileData) return;

      const headerArea = post.querySelector('h2, h3, h4');
      if (!headerArea) return;

      const container = headerArea.closest('div');
      if (!container) return;
      if (container.querySelector(`.${BUTTON_CLASS}`)) return;

      const btn = createSaveButton(profileData);
      btn.style.fontSize = '11px';
      btn.style.padding = '3px 10px';

      const wrapper = document.createElement('div');
      wrapper.style.marginTop = '4px';
      wrapper.appendChild(btn);
      container.appendChild(wrapper);
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

  setTimeout(init, 2000);
  setTimeout(init, 5000);
})();

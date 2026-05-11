document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key');
  const locationIdInput = document.getElementById('location-id');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const saveBtn = document.getElementById('save-btn');
  const profileSection = document.getElementById('profile-section');
  const noProfileSection = document.getElementById('no-profile-section');
  const statusBanner = document.getElementById('status-banner');
  const settingsIcon = document.getElementById('settings-icon');
  const settingsModal = document.getElementById('settings-modal');
  const closeModal = document.getElementById('close-modal');

  let currentProfileData = null;

  loadSettings();
  detectCurrentProfile();

  // Settings modal
  settingsIcon.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  closeModal.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
    }
  });

  saveSettingsBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const locationId = locationIdInput.value.trim();

    if (!apiKey || !locationId) {
      showBanner('Both API Key and Location ID are required.', 'error');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      data: { ghl_api_key: apiKey, ghl_location_id: locationId }
    }, (response) => {
      if (response && response.success) {
        showBanner('Settings saved successfully.', 'success');
        settingsModal.classList.add('hidden');
      } else {
        showBanner('Failed to save settings.', 'error');
      }
    });
  });

  saveBtn.addEventListener('click', () => {
    if (!currentProfileData) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    chrome.runtime.sendMessage({ type: 'SAVE_TO_GHL', data: currentProfileData }, (response) => {
      if (response && response.success) {
        saveBtn.textContent = 'Saved';
        saveBtn.classList.add('btn-success');
        showBanner('Contact saved to CRM.', 'success');
      } else {
        saveBtn.textContent = 'Retry';
        saveBtn.disabled = false;
        saveBtn.classList.add('btn-error');
        showBanner(response?.error || 'Failed to save contact.', 'error');
        setTimeout(() => {
          saveBtn.classList.remove('btn-error');
          saveBtn.textContent = 'Save to CRM';
        }, 3000);
      }
    });
  });

  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response) {
        if (response.ghl_api_key) apiKeyInput.value = response.ghl_api_key;
        if (response.ghl_location_id) locationIdInput.value = response.ghl_location_id;
      }
    });
  }

  function detectCurrentProfile() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) return;

      const url = tab.url;
      const isFacebook = url.includes('facebook.com');
      const isInstagram = url.includes('instagram.com');
      const isLinkedin = url.includes('linkedin.com');
      const isTwitter = url.includes('x.com') || url.includes('twitter.com');

      if (!isFacebook && !isInstagram && !isLinkedin && !isTwitter) return;

      chrome.tabs.sendMessage(tab.id, { type: 'GET_PROFILE_DATA' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.data && (response.data.name || response.data.username)) {
          displayProfile(response.data);
        }
      });
    });
  }

  function displayProfile(data) {
    currentProfileData = data;
    noProfileSection.classList.add('hidden');
    profileSection.classList.remove('hidden');

    const avatarEl = document.getElementById('profile-avatar');
    const nameEl = document.getElementById('profile-name');
    const detailEl = document.getElementById('profile-detail');
    const platformEl = document.getElementById('profile-platform');

    nameEl.textContent = data.name || data.username || 'Unknown';

    if (data.platform === 'facebook') {
      detailEl.textContent = data.intro?.bio || data.followers || '';
    } else if (data.platform === 'instagram') {
      detailEl.textContent = data.bio || `@${data.username}` || '';
    } else if (data.platform === 'linkedin') {
      detailEl.textContent = data.headline || data.current_company || '';
    } else if (data.platform === 'twitter') {
      detailEl.textContent = data.bio || `@${data.username}` || '';
    }

    platformEl.textContent = data.platform;
    platformEl.className = `profile-platform ${data.platform}`;

    if (data.profile_picture_url) {
      avatarEl.src = data.profile_picture_url;
      avatarEl.style.display = 'block';
    } else {
      avatarEl.style.display = 'none';
    }
  }

  function showBanner(message, type) {
    statusBanner.textContent = message;
    statusBanner.className = `banner ${type}`;
    statusBanner.classList.remove('hidden');

    setTimeout(() => {
      statusBanner.classList.add('hidden');
    }, 4000);
  }
});

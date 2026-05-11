chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_TO_GHL') {
    saveContactToGHL(message.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['ghl_api_key', 'ghl_location_id'], (data) => {
      sendResponse(data);
    });
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set({
      ghl_api_key: message.data.ghl_api_key,
      ghl_location_id: message.data.ghl_location_id
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function saveContactToGHL(contactData) {
  const settings = await chrome.storage.local.get(['ghl_api_key', 'ghl_location_id']);

  if (!settings.ghl_api_key || !settings.ghl_location_id) {
    return { success: false, error: 'API key and Location ID are required. Open the extension popup to configure.' };
  }

  const apiKey = settings.ghl_api_key.trim();
  const body = buildGHLContactBody(contactData, settings.ghl_location_id);

  // Detect token type: v1 Location API Key vs v2 Private Integration Token
  const isV1Key = isV1LocationKey(apiKey);

  if (isV1Key) {
    // Try v1 API (deprecated but may still work for existing keys)
    return await callV1API(apiKey, body);
  }

  // v2 API (Private Integration Token or OAuth token)
  const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      return { success: false, error: 'Authentication failed. Make sure you are using a Private Integration Token (not a Location API Key). Go to Settings > Integrations > Private Integrations in your CRM to create one.' };
    }
    return { success: false, error: `API error ${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, contact: result.contact };
}

async function callV1API(apiKey, body) {
  // v1 API uses a different endpoint and body format
  const v1Body = {
    firstName: body.firstName,
    lastName: body.lastName,
    name: body.name,
    email: body.email || '',
    phone: body.phone || '',
    companyName: body.companyName || '',
    website: body.website || '',
    tags: body.tags || [],
    source: body.source || '',
    city: body.city || '',
    state: body.state || '',
    country: body.country || '',
    customField: {}
  };

  // Convert customFields array to v1 format (key-value object)
  if (body.customFields && body.customFields.length) {
    for (const cf of body.customFields) {
      v1Body.customField[cf.key] = cf.field_value;
    }
  }

  const response = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(v1Body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401 || response.status === 404) {
      return { success: false, error: 'V1 Location API Keys are no longer supported (deprecated Dec 2025). Please create a Private Integration Token: Go to Settings > Integrations > Private Integrations in your CRM.' };
    }
    return { success: false, error: `API error ${response.status}: ${errorText}` };
  }

  const result = await response.json();
  return { success: true, contact: result.contact };
}

function isV1LocationKey(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    return payload.version === 1 && payload.location_id;
  } catch (e) {
    return false;
  }
}

function buildGHLContactBody(data, locationId) {
  const body = {
    locationId: locationId,
    source: `${data.platform || 'social'}_profile_saver`
  };

  if (data.platform === 'facebook') {
    const nameParts = splitName(data.name);
    body.firstName = nameParts.firstName;
    body.lastName = nameParts.lastName;
    body.name = data.name || '';
    body.website = data.website || '';
    body.tags = ['facebook', 'social-profile-saver'];

    const customFields = [];
    customFields.push({ key: 'facebook_profile_url', field_value: data.url });
    if (data.profile_picture_url) customFields.push({ key: 'profile_picture', field_value: data.profile_picture_url });
    if (data.followers) customFields.push({ key: 'facebook_followers', field_value: data.followers });
    if (data.friends) customFields.push({ key: 'facebook_friends', field_value: data.friends });

    if (data.intro) {
      if (data.intro.bio) customFields.push({ key: 'bio', field_value: data.intro.bio });
      if (data.intro.company) {
        body.companyName = data.intro.company;
      } else if (data.intro.work && data.intro.work.length > 0) {
        body.companyName = data.intro.work[0];
      }
      if (data.intro.work && data.intro.work.length > 0) {
        customFields.push({ key: 'work_history', field_value: data.intro.work.join(' | ') });
      }
      if (data.intro.role) customFields.push({ key: 'role', field_value: data.intro.role });
      if (data.intro.education && data.intro.education.length > 0) {
        customFields.push({ key: 'education', field_value: data.intro.education.join(' | ') });
      }
      if (data.intro.locations && data.intro.locations.length > 0) {
        const loc = data.intro.locations[0];
        const cityMatch = loc.match(/(?:lives? in|from)\s+(.+)/i);
        if (cityMatch) body.city = cityMatch[1].trim();
      }
      if (data.intro.relationship) customFields.push({ key: 'relationship_status', field_value: data.intro.relationship });
    }
    if (data.additional_links && data.additional_links.length > 0) {
      customFields.push({ key: 'additional_links', field_value: data.additional_links.join(', ') });
    }

    if (customFields.length) body.customFields = customFields;

  } else if (data.platform === 'instagram') {
    const nameParts = splitName(data.name);
    body.firstName = nameParts.firstName;
    body.lastName = nameParts.lastName;
    body.name = data.name || data.username || '';
    body.website = data.external_url || '';
    body.tags = ['instagram', 'social-profile-saver'];

    const customFields = [];
    customFields.push({ key: 'instagram_profile_url', field_value: data.url });
    customFields.push({ key: 'instagram_username', field_value: data.username || '' });
    if (data.profile_picture_url) customFields.push({ key: 'profile_picture', field_value: data.profile_picture_url });
    if (data.followers) customFields.push({ key: 'instagram_followers', field_value: data.followers });
    if (data.following) customFields.push({ key: 'instagram_following', field_value: data.following });
    if (data.posts_count) customFields.push({ key: 'instagram_posts', field_value: data.posts_count });
    if (data.bio) customFields.push({ key: 'bio', field_value: data.bio });
    if (data.category) customFields.push({ key: 'instagram_category', field_value: data.category });
    if (data.is_verified) customFields.push({ key: 'is_verified', field_value: 'true' });

    if (customFields.length) body.customFields = customFields;

  } else if (data.platform === 'linkedin') {
    const nameParts = splitName(data.name);
    body.firstName = nameParts.firstName;
    body.lastName = nameParts.lastName;
    body.name = data.name || '';
    body.website = data.website || '';
    body.tags = ['linkedin', 'social-profile-saver'];

    if (data.current_company) body.companyName = data.current_company;
    if (data.location) {
      const parts = data.location.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        body.city = parts[0];
        body.state = parts.length >= 3 ? parts[1] : '';
        body.country = parts[parts.length - 1];
      } else {
        body.city = data.location;
      }
    }

    const customFields = [];
    customFields.push({ key: 'linkedin_profile_url', field_value: data.url });
    if (data.profile_picture_url) customFields.push({ key: 'profile_picture', field_value: data.profile_picture_url });
    if (data.headline) customFields.push({ key: 'linkedin_headline', field_value: data.headline });
    if (data.about) customFields.push({ key: 'bio', field_value: data.about });
    if (data.followers) customFields.push({ key: 'linkedin_followers', field_value: data.followers });
    if (data.connection_degree) customFields.push({ key: 'linkedin_connection_degree', field_value: data.connection_degree });

    if (data.experience && data.experience.length > 0) {
      const expStr = data.experience.map(e => {
        let s = e.title || '';
        if (e.company) s += ` at ${e.company}`;
        if (e.duration) s += ` (${e.duration})`;
        return s;
      }).join(' | ');
      customFields.push({ key: 'work_history', field_value: expStr });
    }

    if (data.education && data.education.length > 0) {
      const eduStr = data.education.map(e => {
        let s = e.school || '';
        if (e.degree) s += ` - ${e.degree}`;
        if (e.years) s += ` (${e.years})`;
        return s;
      }).join(' | ');
      customFields.push({ key: 'education', field_value: eduStr });
    }

    if (customFields.length) body.customFields = customFields;
  }

  return body;
}

function splitName(fullName) {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

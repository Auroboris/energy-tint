!function() {
  "use strict";

  const EXTENSION_ID = "energy-tint";
  const SETTINGS_STORAGE_KEY = EXTENSION_ID + "-settings";
  const DEFAULTS = {
    enabled: true,
    toggleKey: "I",
    showSelf: true,
    showEnemies: true,
    showTeammates: true,
    showBots: true,
    highThreshold: 75,
    mediumThreshold: 30,
    emptyThreshold: 0,
    tintIntensity: 80,
    pulseTint: true,
    pulseSpeed: 900,
    pulseAmount: 20,
    highColorPreset: "#34c759",
    highCustomColor: "#34c759",
    mediumColorPreset: "#ffcc00",
    mediumCustomColor: "#ffcc00",
    lowColorPreset: "#ff3b30",
    lowCustomColor: "#ff3b30"
  };

  const COLOR_OPTIONS = {
    "#ffffff": "White",
    "#00ffff": "Cyan",
    "#007aff": "Blue",
    "#34c759": "Green",
    "#ffcc00": "Yellow",
    "#ff9500": "Orange",
    "#ff3b30": "Red",
    "#af52de": "Purple",
    custom: "Custom HEX color"
  };

  function loadSavedSettings() {
    try {
      if (typeof localStorage === "undefined") return {};
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? saved
        : {};
    } catch (error) {
      return {};
    }
  }

  let settings = Object.assign({}, DEFAULTS, loadSavedSettings());
  let extensionActive = true;
  let gameReady = false;
  let animationFrame = null;
  const tintedPlanes = new Map();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function nowMs() {
    if (typeof performance !== "undefined" &&
      typeof performance.now === "function") {
      return performance.now();
    }

    return Date.now();
  }

  function parseHexColor(value) {
    const normalized = String(value || "")
      .trim()
      .replace(/^0x/i, "")
      .replace(/^#/, "");

    if (/^[0-9a-f]{3}$/i.test(normalized)) {
      return parseInt(normalized.split("").map(function(character) {
        return character + character;
      }).join(""), 16);
    }

    if (/^[0-9a-f]{6}$/i.test(normalized)) {
      return parseInt(normalized, 16);
    }

    return null;
  }

  function getConfiguredColor(prefix, fallback) {
    const preset = settings[prefix + "ColorPreset"];
    const selected = preset === "custom"
      ? settings[prefix + "CustomColor"]
      : preset;
    const parsed = parseHexColor(selected);
    return parsed === null ? parseHexColor(fallback) : parsed;
  }

  function mixColors(base, target, amount) {
    const weight = clamp(amount, 0, 1);
    const baseRed = base >> 16 & 255;
    const baseGreen = base >> 8 & 255;
    const baseBlue = base & 255;
    const targetRed = target >> 16 & 255;
    const targetGreen = target >> 8 & 255;
    const targetBlue = target & 255;
    const red = Math.round(baseRed + (targetRed - baseRed) * weight);
    const green = Math.round(baseGreen + (targetGreen - baseGreen) * weight);
    const blue = Math.round(baseBlue + (targetBlue - baseBlue) * weight);

    return red << 16 | green << 8 | blue;
  }

  function getPlayers() {
    try {
      if (typeof Players.all === "function") return Players.all();

      if (typeof Players.getIDs === "function" && typeof Players.get === "function") {
        const players = {};
        Object.keys(Players.getIDs()).forEach(function(id) {
          const player = Players.get(id);
          if (player) players[id] = player;
        });
        return players;
      }

      return {};
    } catch (error) {
      return {};
    }
  }

  function getMe() {
    try {
      return Players.getMe();
    } catch (error) {
      return null;
    }
  }

  function isTeammate(player, me) {
    return Number(me.team) > 0 && Number(player.team) > 0 &&
      String(player.team) === String(me.team);
  }

  function passesTypeFilter(player, me) {
    if (String(player.id) === String(me.id)) return settings.showSelf;
    if (player.bot) return settings.showBots;
    return isTeammate(player, me)
      ? settings.showTeammates
      : settings.showEnemies;
  }

  function isPlayerVisible(player) {
    const sprite = player && player.sprites ? player.sprites.sprite : null;
    if (!sprite || player.status !== 0 || player.hidden || player.culled ||
      player.timedout || player.stealthed || player.render === false ||
      sprite.visible === false) {
      return false;
    }

    return player.alpha === undefined || Number(player.alpha) > 0.05;
  }

  function readEnergy(player) {
    let energy = Number(player && player.energy);
    if (!Number.isFinite(energy)) return null;
    if (energy > 1 && energy <= 100) energy /= 100;
    return clamp(energy, 0, 1);
  }

  function getEnergyBand(energy) {
    const high = clamp(settings.highThreshold, 5, 100) / 100;
    const medium = Math.min(
      high - 0.01,
      clamp(settings.mediumThreshold, 1, 95) / 100
    );
    const empty = Math.min(
      medium,
      clamp(settings.emptyThreshold, 0, 20) / 100
    );

    if (energy <= empty) return "empty";
    if (energy >= high) return "high";
    if (energy >= medium) return "medium";
    return "low";
  }

  function getBandColor(band) {
    if (band === "high") {
      return getConfiguredColor("high", DEFAULTS.highColorPreset);
    }

    if (band === "medium") {
      return getConfiguredColor("medium", DEFAULTS.mediumColorPreset);
    }

    return getConfiguredColor("low", DEFAULTS.lowColorPreset);
  }

  function getTintAmount(time) {
    const intensity = clamp(settings.tintIntensity, 10, 100) / 100;
    if (!settings.pulseTint) return intensity;

    const duration = clamp(settings.pulseSpeed, 250, 2000);
    const pulseRange = clamp(settings.pulseAmount, 0, 50) / 100;
    const wave = (Math.sin(time / duration * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    return clamp(intensity - pulseRange + pulseRange * wave, 0, 1);
  }

  function restoreEntry(entry) {
    if (!entry || !entry.sprite) return;

    try {
      if (entry.appliedTint === null || entry.sprite.tint === entry.appliedTint) {
        entry.sprite.tint = entry.originalTint;
      }
    } catch (error) {
      // The game may already have removed the plane sprite.
    }

    entry.appliedTint = null;
  }

  function removeEntry(id) {
    const key = String(id);
    const entry = tintedPlanes.get(key);
    if (!entry) return;
    restoreEntry(entry);
    tintedPlanes.delete(key);
  }

  function restoreAll() {
    Array.from(tintedPlanes.keys()).forEach(removeEntry);
  }

  function ensureEntry(player) {
    const key = String(player.id);
    const sprite = player && player.sprites ? player.sprites.sprite : null;
    let entry = tintedPlanes.get(key);

    if (!sprite) {
      removeEntry(key);
      return null;
    }

    if (!entry || entry.sprite !== sprite) {
      removeEntry(key);
      entry = {
        sprite: sprite,
        originalTint: Number.isFinite(Number(sprite.tint))
          ? Number(sprite.tint)
          : 0xffffff,
        appliedTint: null
      };
      tintedPlanes.set(key, entry);
    }

    return entry;
  }

  function applyTint(entry, color, amount) {
    if (entry.appliedTint !== null && entry.sprite.tint !== entry.appliedTint) {
      entry.originalTint = Number.isFinite(Number(entry.sprite.tint))
        ? Number(entry.sprite.tint)
        : 0xffffff;
    }

    const tint = mixColors(entry.originalTint, color, amount);
    entry.sprite.tint = tint;
    entry.appliedTint = tint;
  }

  function updateTints() {
    const players = getPlayers();
    const me = getMe();
    const time = nowMs();

    tintedPlanes.forEach(function(entry, id) {
      if (!players[id] && !players[Number(id)]) removeEntry(id);
    });

    if (!gameReady || !settings.enabled || !extensionActive || !me) {
      restoreAll();
      return;
    }

    Object.keys(players).forEach(function(id) {
      const player = players[id];
      if (!player) return;

      const entry = ensureEntry(player);
      if (!entry) return;

      const energy = readEnergy(player);
      const visible = energy !== null && isPlayerVisible(player) &&
        passesTypeFilter(player, me);

      if (!visible) {
        restoreEntry(entry);
        return;
      }

      const band = getEnergyBand(energy);
      if (band === "empty") {
        restoreEntry(entry);
        return;
      }

      applyTint(entry, getBandColor(band), getTintAmount(time));
    });
  }

  function animate() {
    updateTints();
    animationFrame = requestAnimationFrame(animate);
  }

  function start() {
    gameReady = true;
    if (!animationFrame) animationFrame = requestAnimationFrame(animate);
    updateTints();
  }

  function stop() {
    gameReady = false;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    restoreAll();
  }

  function normalizeKey(value) {
    let key = String(value || "").trim().toLowerCase();
    if (key === "spacebar") key = "space";
    if (/^key[a-z]$/.test(key)) key = key.slice(3);
    if (/^digit[0-9]$/.test(key)) key = key.slice(5);
    return key;
  }

  function isTyping(event) {
    const target = event && event.target;
    const tagName = target && target.tagName
      ? String(target.tagName).toLowerCase()
      : "";

    if (["input", "textarea", "select"].includes(tagName) ||
      (target && target.isContentEditable)) {
      return true;
    }

    try {
      return typeof UI !== "undefined" && typeof UI.chatBoxOpen === "function" &&
        UI.chatBoxOpen();
    } catch (error) {
      return false;
    }
  }

  function handleKeyDown(event) {
    if (!event || event.repeat || isTyping(event)) return;
    const pressed = [event.key, event.code].map(normalizeKey);
    const wanted = normalizeKey(settings.toggleKey || DEFAULTS.toggleKey);

    if (pressed.includes(wanted)) {
      extensionActive = !extensionActive;
      updateTints();
    }
  }

  function settingsApplied(values) {
    settings = Object.assign({}, DEFAULTS, values || {});

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      }
    } catch (error) {
      // StarMash still keeps its own saved copy if local storage is unavailable.
    }

    updateTints();
  }

  function addColorFields(section, prefix, label) {
    section.addValuesField(prefix + "ColorPreset", label + " color", COLOR_OPTIONS);
    section.addString(
      prefix + "CustomColor",
      "Custom " + label.toLowerCase() + " HEX color",
      {maxLength: 7}
    );
  }

  function createSettingsProvider() {
    const provider = new SettingsProvider(settings, settingsApplied);
    const displaySection = provider.addSection("Display");

    displaySection.addBoolean("enabled", "Show energy tints");
    displaySection.addString("toggleKey", "Energy-tint toggle key", {maxLength: 20});
    displaySection.addBoolean("showSelf", "Tint my plane");
    displaySection.addBoolean("showEnemies", "Tint enemy players");
    displaySection.addBoolean("showTeammates", "Tint teammates");
    displaySection.addBoolean("showBots", "Tint bots");

    const bandSection = provider.addSection("Energy Bands");

    bandSection.addSliderField("highThreshold", "High energy begins at", {
      min: 5,
      max: 100,
      step: 5
    });
    bandSection.addSliderField("mediumThreshold", "Medium energy begins at", {
      min: 1,
      max: 95,
      step: 1
    });
    bandSection.addSliderField("emptyThreshold", "No-tint energy cutoff", {
      min: 0,
      max: 20,
      step: 1
    });

    const colorSection = provider.addSection("Tint Colors");

    addColorFields(colorSection, "high", "High energy");
    addColorFields(colorSection, "medium", "Medium energy");
    addColorFields(colorSection, "low", "Low energy");

    const effectSection = provider.addSection("Tint Effect");

    effectSection.addSliderField("tintIntensity", "Tint intensity", {
      min: 10,
      max: 100,
      step: 5
    });
    effectSection.addBoolean("pulseTint", "Pulse the energy tint");
    effectSection.addSliderField("pulseSpeed", "Pulse interval", {
      min: 250,
      max: 2000,
      step: 50
    });
    effectSection.addSliderField("pulseAmount", "Pulse strength", {
      min: 0,
      max: 50,
      step: 5
    });

    return provider;
  }

  SWAM.on("gameRunning", start);
  SWAM.on("gamePrep", start);
  SWAM.on("gameWipe", stop);
  SWAM.on("keydown", handleKeyDown);
  SWAM.on("playerDestroyed", function(player) {
    if (player) removeEntry(player.id);
  });

  SWAM.registerExtension({
    name: "Energy Tint",
    id: EXTENSION_ID,
    description: "Color-coded plane tints that turn visible energy levels into clear high, medium, low, and empty states in StarMash.",
    author: "Auroboris",
    version: "1.0.0",
    settingsProvider: createSettingsProvider()
  });
}();

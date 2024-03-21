/*
Ideas:
 - Clean design of new ui
 - change select text versus options for playing: audio
 - cross fading between bgm / start a different time
 - fading should appear before end when switching randomly
 - Background based ambient sounds
    - import option on background UI ?
 - Allow background music edition using background menu
    - https://fontawesome.com/icons/music?f=classic&s=solid
    - https://codepen.io/noirsociety/pen/rNQxQwm
    - https://codepen.io/xrocker/pen/abdKVGy
*/

import { saveSettingsDebounced, getRequestHeaders } from '../../../../script.js';
import { getContext, extension_settings, ModuleWorkerWrapper } from '../../../extensions.js';
import { isDataURL } from '../../../utils.js';
import { registerSlashCommand } from '../../../slash-commands.js';
export { MODULE_NAME };

import { modalAPI, modalCreator } from './libs/modal.js';
import { PackManagerV1 } from './libs/packmanager.v1.js';

const extensionName = 'Extension-Audio';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const MODULE_NAME = 'Audio';
const DEBUG_PREFIX = '<Audio module> ';
const UPDATE_INTERVAL = 1000;

const ASSETS_BGM_FOLDER = 'bgm';
const ASSETS_AMBIENT_FOLDER = 'ambient';
const CHARACTER_BGM_FOLDER = 'bgm';
const ASSETS_UI_INTERACTIONS_FOLDER = 'sfx';

const FALLBACK_EXPRESSION = 'neutral';
const DEFAULT_EXPRESSIONS = [
    //"talkinghead",
    'admiration',
    'amusement',
    'anger',
    'annoyance',
    'approval',
    'caring',
    'confusion',
    'curiosity',
    'desire',
    'disappointment',
    'disapproval',
    'disgust',
    'embarrassment',
    'excitement',
    'fear',
    'gratitude',
    'grief',
    'joy',
    'love',
    'nervousness',
    'optimism',
    'pride',
    'realization',
    'relief',
    'remorse',
    'sadness',
    'surprise',
    'neutral',
];
const SPRITE_DOM_ID = '#expression-image';

let current_chat_id = null;

let fallback_BGMS = null; // Initialized only once with module workers
let ambients = null; // Initialized only once with module workers
let characterMusics = {}; // Updated with module workers

let currentCharacterBGM = null;
let currentExpressionBGM = null;
let currentBackground = null;

let cooldownBGM = 0;

let bgmEnded = true;

//#############################//
//  Extension UI and Settings  //
//#############################//

const defaultSettings = {
    enabled: false,
    dynamic_bgm_enabled: false,
    //dynamic_ambient_enabled: false,

    bgm_locked: true,
    bgm_muted: true,
    bgm_volume: 50,
    bgm_selected: null,

    ambient_locked: true,
    ambient_muted: true,
    ambient_volume: 50,
    ambient_selected: null,

    bgm_cooldown: 30,
};



// CLASSES : ( experimental ) DropDown

class dropdown extends EventTarget {
    dialog = null;
    dialogBody = null;
    id = '';
    dropdown = null;
    items = null;
    value = null;
    constructor(id) {
        super();
        this.id = id;
        this.dropdown = `div.dropdown${ id ? `#${id}` : '' }`;
        this.items = [];
    }

    setItems(items) {
        items = items.filter((item) => item);
        this.items = items;
    }

    addItem(item) {
        this.items.push(item);
    }

    draw(opts) {
        const base = $(`<div class='dropdown' id='${this.id}' style='${opts && opts.style ? opts.style : ''}'>
            <p class='selected'>Select</p>
            <div class='icon ico-white'>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7,10L12,15L17,10H7Z" /></svg>
            </div>
        </div>`);
        return base;
    }

    remove() {
        $(this.dropdown).removeClass('open');
        this.dialog.remove();
    }

    openDropdown(c, dispatch) {
        const dialog = $(`<div class='dropdown-dialog'>
            <div class="dismiss-box"></div>
        </div>`);

        let headertest = ""
        try {
            headertest = c.items.filter((item) => item.value === c.value)[0].text
        } catch (e) {
            console.error('Error setting value', e);
            headertest = "Select"
        }

        const dialogBody = $(`<div class='body'>
        <div class='btn-close' style="display: flex;">${headertest}
            <div class='icon ico-white' style="margin-left: auto; height:auto;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>close</title><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" /></svg>
            </div>
        </div>
        </div>`);
        dialog.append(dialogBody);
        c.dialog = dialog;
        c.dialogBody = dialogBody;
        $('body').append(c.dialog);

        c.items.forEach((item) => {
            // is value or text missing?
            if (!item.value || !item.text) {
                console.error('Invalid item', item);
                return;
            }

            const el = $("<div class='item' data-value='"+item.value+"'>"+item.text+"</div>");
            if (item.value === c.value) {
                el.addClass('selected');
            }
            el.on('click', () => {
                c.setValue(item.value);
                $(c.dropdown).removeClass('open');
                dialog.remove();
            });
            dialogBody.append(el);
        });

        const leftright_padding =
            $(c.dropdown).css('padding-left').replace('px', '') * 1 +
            $(c.dropdown).css('padding-right').replace('px', '') * 1;

        c.dialogBody.css({
            top:  $(c.dropdown).offset().top - window.scrollY,
            left: $(c.dropdown).offset().left,
            width: $(c.dropdown).width() + leftright_padding + 2,
        });
        dialog.addClass('open');
        dialog.find('.dismiss-box').on('click', () => {
            $(c.dropdown).removeClass('open');
            dialog.remove();
        });
        dialogBody.find('.btn-close').on('click', () => {
            $(c.dropdown).removeClass('open');
            dialog.remove();
        });

        // call resize event
        // $(window).trigger('resize');
    }

    init() {
        const dropdown = $(this.dropdown);
        const openDropdown = this.openDropdown;
        const dispatch = (id, value) => {
            const event = new Event('change', {});
            event.detail = {
                id: id,
                value: value
            };
            this.dispatchEvent(event);
        }
        const c = this;

        const relocateDialog = (c) => {
            const leftright_padding =
                $(c.dropdown).css('padding-left').replace('px', '') * 1 +
                $(c.dropdown).css('padding-right').replace('px', '') * 1;

            c.dialogBody.css({
                top:  $(c.dropdown).offset().top - window.scrollY,
                left: $(c.dropdown).offset().left,
                width: $(c.dropdown).width() + leftright_padding + 2,
            });
        }


        // watch for window resize
        $(window).on('resize', function() {
            if (c.dialogBody) {
                relocateDialog(c);
            }
        });
        // watch for window scroll
        $(window).on('scroll', function() {
            if (c.dialogBody) {
                relocateDialog(c);
            }
        });

        dropdown.on('click', function() {
            if (dropdown.hasClass('open')) {
                dropdown.removeClass('open');
                c.dialog.remove();
            } else {
                dropdown.addClass('open');
                openDropdown(c, dispatch);
            }
        });

        // check if the mouse is outside the dropdown
    }

    on(event, callback) {
        this.addEventListener(event, (event) => {
            callback(event);
        });
    }

    setValue(value) {
        this.value = value;
        try {
            $(`${this.dropdown} .selected`).text(this.items.filter((item) => item.value === value)[0].text);
            const event = new Event('change', {});
            event.detail = {
                id: this.id,
                value: value
            };
            this.dispatchEvent(event);
        } catch (e) {
            console.error('Error setting value', e);
        }
    }
}

class UIInteractions {
    audioClick = new Audio();
    audioHover = new Audio();
    multibleSoundsClicks = false;
    multibleSoundsHover = false;
    constructor() {
        this.assetsfolder = '';
        this.audioClick.src = this.assetsfolder + ""
        this.audioHover.src = this.assetsfolder + ""
        this.assetsClick = []
        this.assetsHover = []
        // "shutter.wav",
        // goofy
        // this.audioHover.src = "assets/sfx/goofy/Bonk Sound Effect 2 (1).wav";
    }

    setRandomSounds(sounds) {
        this.assetsClick = sounds;
    }

    setEnableRandomSounds(enable) {
    }

    setVolume(volume) {
        if (volume == null) { throw new Error('Volume is null'); }
        if (isNaN(volume)) { throw new Error('Volume is NaN'); }
        if (typeof volume === 'number') {
            this.audioClick.volume = volume;
            this.audioHover.volume = volume;
        } else {
            throw new Error('Volume is not a number');
        }
    }

    setPack(pack) {
        this.assetsClick = pack.assetsClick;
        this.assetsHover = pack.assetsHover;
        this.assetsfolder = pack.folder;
        this.multibleSoundsClicks = pack.multiSoundsClicks;
        this.multibleSoundsHover = pack.multiSoundsHover;
        this.audioClick.src = pack.folder + pack.click;
        this.audioHover.src = pack.folder + pack.hover;
    }

    init() {
        const audioClick = this.audioClick;
        const audioHover = this.audioHover;

        const slectors = "select, input, " +
            ".menu_button, " +
            "#extensionsMenuButton, #options_button, #send_but, " +
            ".extensions_block .inline-drawer .inline-drawer-toggle, " +
            "#top-settings-holder .drawer .drawer-icon, " +
            ".dropdown-dialog .item, .dropdown-dialog .btn-close";

        const clicks = this.assetsClick;
        const hovers = this.assetsHover;
        const assetsfolder = this.assetsfolder;
        const randomSoundsClick = this.multibleSoundsClicks;
        const randomSoundsHover = this.multibleSoundsHover;

        // add click event to all buttons
        $(document).on("click", slectors, function() {
            if (!extension_settings.audio.enabled)
                return;
            if (randomSoundsClick) {
                const sound = assetsfolder + clicks[Math.floor(Math.random() * Object.keys(clicks).length)];
                audioClick.src = sound;
            }
            audioClick.currentTime = 0;
            audioClick.play();
        });

        $(document).on("mouseenter", slectors, function() {
            if (!extension_settings.audio.enabled)
                return;
            if (randomSoundsHover) {
                const sound = assetsfolder + hovers[Math.floor(Math.random() * Object.keys(hovers).length)];
                audioHover.src = sound;
            }
            audioHover.currentTime = 0;
            audioHover.play();
        });
    }

    dispose() {
        $(document).off("click");
        $(document).off("mouseenter");
    }
}

class UIInteractions_PackInfo {
    root = document.createElement('div');
    pack_name = "No pack selected"
    pack_icon = null;
    pack_description = "";

    constructor() {
        this.root.attachShadow({ mode: "open" });
        this.root.classList.add('pack-info');
        this.root.shadowRoot.innerHTML = `
            <link rel="stylesheet" href="css/fontawesome.css" />
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                .flex {
                    display: flex;
                }
                button { cursor: pointer; border: none; background: none; color: inherit;
                    width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
                }
                .config-section {
                    border: 1px rgb(75, 75, 75) solid;
                    padding: 10px;
                    margin: 10px 0px;
                }
                .pack-info .pack-icon {
                    min-width: 100px;
                    min-height: 100px;
                    max-width: 100px;
                    max-height: 100px;
                    background-color: #222;
                    border-radius: 50%;
                    background-size: cover;
                    background-position: center;
                    background-image: url('img/No-Image-Placeholder.svg');
                }
                ul {
                    list-style: none;
                }
                .pack-info {
                    overflow: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .pack-info .body {
                    display: flex;
                    gap: 24px;
                }
                .pack-info .body .pack-summary {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                }
                .pack-info.mobile .view-mobile {
                    flex-direction: column !important;
                }
                .pack-info.mobile .view-mobile-row {
                    flex-direction: row !important;
                }
            </style>
            <audio id="audio_preview" src="" preload="auto"></audio>
            <div class="pack-info">
                <div class="header">
                    <h2>No pack selected</h2>
                </div>
                <div class="body view-mobile">
                    <div class="pack-information view-mobile-row" style="display: flex; flex-direction: column; gap: 10px;">
                        <div class="pack-icon"></div>
                        <p class="author">Author: <span>Unknown</span></p>
                    </div>
                    <div class="pack-summary">
                        <p class="description">No pack selected</p>
                        <div class="pack-configured-items">
                            <p>Configured items:</p>
                            <div class="configured"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // check if the pack-info is in mobile view
        const packInfo = this.root.shadowRoot.querySelector('.pack-info');
        if (window.innerWidth <= 768) {
            packInfo.classList.add('mobile');
        }
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                packInfo.classList.add('mobile');
            } else {
                packInfo.classList.remove('mobile');
            }
        });
    }

    draw() {
        return this.root;
    }

    setName(name) {
        // @ts-expect-error
        this.root.shadowRoot.querySelector('.header h2').innerText = name;
    }

    clear() {
        const shadowRoot = this.root.shadowRoot;
        // @ts-expect-error
        shadowRoot.querySelector('.pack-icon').style.backgroundImage = `url("img/No-Image-Placeholder.svg")`;
        // @ts-expect-error
        shadowRoot.querySelector('.header h2').innerText = "No pack selected";
        // @ts-expect-error
        shadowRoot.querySelector('.description').innerText = "No description";
        // @ts-expect-error
        shadowRoot.querySelector('.author span').innerText = "Unknown";
        shadowRoot.querySelector('.configured').innerHTML = '';
    }

    setManifest(manifest) {

        const shadowRoot = this.root.shadowRoot;
        const configured = shadowRoot.querySelector('.configured');
        configured.innerHTML = '';
        if (manifest === null) {
            this.clear();
            throw new Error('Manifest is null');
        }
        console.log('Setting manifest', manifest.name);
        // @ts-expect-error
        shadowRoot.querySelector('.pack-icon').style.backgroundImage = `url("img/No-Image-Placeholder.svg")`;
        if (manifest === null) {
            manifest = {
                name: "No pack selected",
                description: "No description",
                icon: "img/No-Image-Placeholder.svg",
                author: "Unknown",
            }
        }
        // @ts-expect-error
        shadowRoot.querySelector('.pack-icon').style.backgroundImage = `url(${manifest.icon || "img/No-Image-Placeholder.svg"})`;
        // @ts-expect-error
        shadowRoot.querySelector('.header h2').innerText = manifest.name || "No pack selected";
        // @ts-expect-error
        shadowRoot.querySelector('.description').innerText = manifest.description || "No description";
        // @ts-expect-error
        shadowRoot.querySelector('.author span').innerText = manifest.author || "Unknown";

        if (manifest === null) {
            return;
        }

        const audio = shadowRoot.querySelector('#audio_preview');
        // audio on stop
        audio.onended = () => {
            // replace the stop icon with the play icon
            const playButtons = shadowRoot.querySelectorAll('.play-button.playing');

            for (const playButton of playButtons) {
                playButton.innerHTML = `<i class="fa-solid fa-sm fa-headphones-simple"></i>`;
                playButton.classList.remove('playing');
            }
        }
        // source change
        audio.onloadeddata = () => {
            const playButtons = shadowRoot.querySelectorAll('.play-button.playing');

            for (const playButton of playButtons) {
                playButton.innerHTML = `<i class="fa-solid fa-sm fa-headphones-simple"></i>`;
                playButton.classList.remove('playing');
                // does the button have the 'button-clicked' class?
                if (playButton.classList.contains('button-clicked')) {
                    // change the icon to a stop icon
                    playButton.innerHTML = `<i class="fa-solid fa-sm fa-stop"></i>`;
                    // remove the 'button-clicked' class
                    playButton.classList.remove('button-clicked');
                    playButton.classList.add('playing');
                }
            }
        }

        const previewAudio = (src) => {
            console.log('Previewing audio', src);
            // @ts-expect-error
            audio.src = src;
            // @ts-expect-error
            audio.play();
        }
        const stopAudio = () => {
            // @ts-expect-error
            audio.pause();
            // @ts-expect-error
            audio.currentTime = 0;
        }

        const createPreviewButton = (src) => {
            const button = document.createElement('button');
            const icon = `<i class="fa-solid fa-sm fa-headphones-simple"></i>`
            button.innerHTML = icon;
            button.style.marginRight = "5px";
            button.classList.add('play-button');
            button.onclick = () => {
                if (button.classList.contains('playing')) {
                    stopAudio();
                    button.classList.remove('playing');
                    button.innerHTML = `<i class="fa-solid fa-sm fa-headphones-simple"></i>`;
                } else {
                    button.classList.add('playing');
                    button.classList.add('button-clicked');
                    previewAudio(src)
                    button.innerHTML = `<i class="fa-solid fa-sm fa-stop"></i>`;
                }
            };
            return button;
        }

        const createMuteButton = (audio) => {
            // <div id="audio_ui_mute" class="menu_button audio-player-button">
            //     <i class="fa-solid fa-volume-high fa-lg fa-fw" id="audio_ui_mute_icon"></i>
            // </div>
            const button = document.createElement('button');
            const icon = document.createElement('i');
            icon.classList.add('fa-solid');
            icon.classList.add('fa-volume-high');
            icon.classList.add('fa-lg');
            icon.classList.add('fa-fw');
            icon.id = audio + '_mute_icon';
            button.appendChild(icon);
            button.classList.add('menu_button');
            button.classList.add('audio-player-button');
            button.onclick = () => {
                const muted = $(`#${audio}`).prop('muted');
                $(`#${audio}`).prop('muted', !muted);
                icon.classList.toggle('fa-volume-high');
                icon.classList.toggle('fa-volume-mute');
            };
            return button;
        }

        const configured_files = document.createElement('div');
        configured_files.style.display = "flex";
        configured_files.style.flexDirection = "row";
        configured_files.style.justifyContent = "space-between";
        configured_files.classList.add('view-mobile');
        configured.appendChild(configured_files);


        // this.root.shadowRoot.querySelector('.pack-icon').style.backgroundImage = `url(${manifest.icon})`;
        if (manifest.click_behaviour) {
            const configured_onclick = document.createElement('div');
            configured_onclick.classList.add("config-section");
            configured_onclick.style.marginRight = "5px";
            configured_onclick.style.width = "100%";
            configured_files.appendChild(configured_onclick);

            const header = document.createElement('div');
            const behaviour = document.createElement('h3');
            behaviour.innerText = `Click: ${manifest.click_behaviour}`;
            header.appendChild(behaviour);

            configured_onclick.appendChild(header);

            const list = document.createElement('div');
            if (manifest.click_behaviour === "single") {
                const f = document.createElement('div');
                f.classList.add('flex');
                f.innerText = `${manifest.file_onclick}`;
                f.prepend(createPreviewButton(`${manifest.folder}${manifest.file_onclick}`));
                list.appendChild(f);
            } else if (manifest.click_behaviour === "multiple") {
                manifest.files_onclick.map((file) => {
                    const f = document.createElement('div');
                    f.classList.add('flex');
                    f.innerText = file;
                    f.prepend(createPreviewButton(`${manifest.folder}${file}`));
                    list.appendChild(f);
                });
            } else {
                list.innerText = `None`;
            }
            configured_onclick.appendChild(list);
        }


        if (manifest.hover_behaviour) {
            const configured_mouseneter = document.createElement('div');
            configured_mouseneter.classList.add("config-section");
            configured_mouseneter.style.width = "100%";
            configured_files.appendChild(configured_mouseneter);

            const hover = document.createElement('h3');
            hover.innerText = `Hover: ${manifest.hover_behaviour}`;
            configured_mouseneter.appendChild(hover);

            const list = document.createElement('div');
            if (manifest.hover_behaviour === "single") {
                const f = document.createElement('div');
                f.classList.add('flex');
                f.innerText = `${manifest.file_onhover}`;
                f.prepend(createPreviewButton(`${manifest.folder}${manifest.file_onhover}`));
                list.appendChild(f);
            } else if (manifest.hover_behaviour === "multiple") {
                manifest.files_onhover.map((file) => {
                    list.appendChild(document.createElement('div')).innerText = file;
                });
            } else if (manifest.hover_behaviour === "conditional") {
                list.innerText = `Conditional`;

                const condition = document.createElement('div');
                condition.innerText = `Condition: Not implemented yet`;
                list.appendChild(condition);
            } else {
                list.innerText = `None`;
            }
            configured_mouseneter.appendChild(list);
        }
    }
}

class VolumeTooltip {
    overlay = document.createElement('div');
    tooltip = document.createElement('div');
    currentSlider = null;
    selector = null;
    constructor( selector ) {
        this.selector = selector;
        this.overlay.classList.add('volume-overlay');
        this.tooltip.classList.add('volume-tooltip');
        this.overlay.appendChild(this.tooltip);
        document.body.appendChild(this.overlay);
    }

    watch() {
        const tooltip = this.tooltip;
        const overlay = this.overlay;
        const selector = this.selector;
        $("html").on("change", selector, function() {
            const slider = $(this);
            const value = slider.val();
            const offset = slider.offset();
            const width = slider.width();
            const left = offset.left + width / 2;
            const top = offset.top - 30;
            tooltip.text(value);
            tooltip.css({ top: top, left: left });
            overlay.addClass('show');
        });
    }

    show() {
    }
    hide() {
    }
}

const packmanager = new PackManagerV1();

function loadSettings() {
    if (extension_settings.audio === undefined)
        extension_settings.audio = {};

    if (Object.keys(extension_settings.audio).length === 0) {
        Object.assign(extension_settings.audio, defaultSettings);
    }
    $('#audio_enabled').prop('checked', extension_settings.audio.enabled);
    $('#audio_dynamic_bgm_enabled').prop('checked', extension_settings.audio.dynamic_bgm_enabled);
    //$("#audio_dynamic_ambient_enabled").prop('checked', extension_settings.audio.dynamic_ambient_enabled);

    $('#audio_bgm_volume').text(extension_settings.audio.bgm_volume);
    $('#audio_ambient_volume').text(extension_settings.audio.ambient_volume);

    $('#audio_bgm_volume_slider').val(extension_settings.audio.bgm_volume);
    $('#audio_ambient_volume_slider').val(extension_settings.audio.ambient_volume);
    $("#audio_ui_volume_slider").val(extension_settings.audio.ui_volume);

    if (extension_settings.audio.bgm_muted) {
        $('#audio_bgm_mute_icon').removeClass('fa-volume-high');
        $('#audio_bgm_mute_icon').addClass('fa-volume-mute');
        $('#audio_bgm_mute').addClass('redOverlayGlow');
        $('#audio_bgm').prop('muted', true);
    }
    else {
        $('#audio_bgm_mute_icon').addClass('fa-volume-high');
        $('#audio_bgm_mute_icon').removeClass('fa-volume-mute');
        $('#audio_bgm_mute').removeClass('redOverlayGlow');
        $('#audio_bgm').prop('muted', false);
    }

    if (extension_settings.audio.bgm_locked) {
        //$("#audio_bgm_lock_icon").removeClass("fa-lock-open");
        //$("#audio_bgm_lock_icon").addClass("fa-lock");
        $('#audio_bgm').attr('loop', true);
        $('#audio_bgm_lock').addClass('redOverlayGlow');
    }
    else {
        //$("#audio_bgm_lock_icon").removeClass("fa-lock");
        //$("#audio_bgm_lock_icon").addClass("fa-lock-open");
        $('#audio_bgm').attr('loop', false);
        $('#audio_bgm_lock').removeClass('redOverlayGlow');
    }

    /*
    if (extension_settings.audio.bgm_selected !== null) {
        $("#audio_bgm_select").append(new Option(extension_settings.audio.bgm_selected, extension_settings.audio.bgm_selected));
        $("#audio_bgm_select").val(extension_settings.audio.bgm_selected);
    }*/

    if (extension_settings.audio.ambient_locked) {
        $('#audio_ambient_lock_icon').removeClass('fa-lock-open');
        $('#audio_ambient_lock_icon').addClass('fa-lock');
        $('#audio_ambient_lock').addClass('redOverlayGlow');
    }
    else {
        $('#audio_ambient_lock_icon').removeClass('fa-lock');
        $('#audio_ambient_lock_icon').addClass('fa-lock-open');
    }

    /*
    if (extension_settings.audio.ambient_selected !== null) {
        $("#audio_ambient_select").append(new Option(extension_settings.audio.ambient_selected, extension_settings.audio.ambient_selected));
        $("#audio_ambient_select").val(extension_settings.audio.ambient_selected);
    }*/

    if (extension_settings.audio.ambient_muted) {
        $('#audio_ambient_mute_icon').removeClass('fa-volume-high');
        $('#audio_ambient_mute_icon').addClass('fa-volume-mute');
        $('#audio_ambient_mute').addClass('redOverlayGlow');
        $('#audio_ambient').prop('muted', true);
    }
    else {
        $('#audio_ambient_mute_icon').addClass('fa-volume-high');
        $('#audio_ambient_mute_icon').removeClass('fa-volume-mute');
        $('#audio_ambient_mute').removeClass('redOverlayGlow');
        $('#audio_ambient').prop('muted', false);
    }

    $('#audio_bgm_cooldown').val(extension_settings.audio.bgm_cooldown);

    $('#audio_debug_div').hide(); // DBG: comment to see debug mode
}

async function onEnabledClick() {
    extension_settings.audio.enabled = $('#audio_enabled').is(':checked');
    if (extension_settings.audio.enabled) {
        if ($('#audio_bgm').attr('src') != '')
            $('#audio_bgm')[0].play();
        if ($('#audio_ambient').attr('src') != '')
            $('#audio_ambient')[0].play();
    } else {
        $('#audio_bgm')[0].pause();
        $('#audio_ambient')[0].pause();
    }
    saveSettingsDebounced();
}

async function onDynamicBGMEnabledClick() {
    extension_settings.audio.dynamic_bgm_enabled = $('#audio_dynamic_bgm_enabled').is(':checked');
    currentCharacterBGM = null;
    currentExpressionBGM = null;
    cooldownBGM = 0;
    saveSettingsDebounced();
}
/*
async function onDynamicAmbientEnabledClick() {
    extension_settings.audio.dynamic_ambient_enabled = $('#audio_dynamic_ambient_enabled').is(':checked');
    currentBackground = null;
    saveSettingsDebounced();
}
*/

//#############################//
//  AUDIO                      //
//#############################//

async function onBGMLockClick() {
    extension_settings.audio.bgm_locked = !extension_settings.audio.bgm_locked;
    if (extension_settings.audio.bgm_locked) {
        extension_settings.audio.bgm_selected = $('#audio_bgm_select').val();
        $('#audio_bgm').attr('loop', true);
    }
    else {
        $('#audio_bgm').attr('loop', false);
    }
    //$("#audio_bgm_lock_icon").toggleClass("fa-lock");
    //$("#audio_bgm_lock_icon").toggleClass("fa-lock-open");
    $('#audio_bgm_lock').toggleClass('redOverlayGlow');
    saveSettingsDebounced();
}

async function onBGMRandomClick() {
    var select = document.getElementById('audio_bgm_select');
    var items = select.getElementsByTagName('option');

    if (items.length < 2)
        return;

    var index;
    do {
        index = Math.floor(Math.random() * items.length);
    } while (index == select.selectedIndex);

    select.selectedIndex = index;
    onBGMSelectChange();
}

async function onBGMMuteClick() {
    extension_settings.audio.bgm_muted = !extension_settings.audio.bgm_muted;
    $('#audio_bgm_mute_icon').toggleClass('fa-volume-high');
    $('#audio_bgm_mute_icon').toggleClass('fa-volume-mute');
    $('#audio_bgm').prop('muted', !$('#audio_bgm').prop('muted'));
    $('#audio_bgm_mute').toggleClass('redOverlayGlow');
    saveSettingsDebounced();
}

async function onAmbientLockClick() {
    extension_settings.audio.ambient_locked = !extension_settings.audio.ambient_locked;
    if (extension_settings.audio.ambient_locked)
        extension_settings.audio.ambient_selected = $('#audio_ambient_select').val();
    else {
        extension_settings.audio.ambient_selected = null;
        currentBackground = null;
    }
    $('#audio_ambient_lock_icon').toggleClass('fa-lock');
    $('#audio_ambient_lock_icon').toggleClass('fa-lock-open');
    $('#audio_ambient_lock').toggleClass('redOverlayGlow');
    saveSettingsDebounced();
}

async function onAmbientMuteClick() {
    extension_settings.audio.ambient_muted = !extension_settings.audio.ambient_muted;
    $('#audio_ambient_mute_icon').toggleClass('fa-volume-high');
    $('#audio_ambient_mute_icon').toggleClass('fa-volume-mute');
    $('#audio_ambient').prop('muted', !$('#audio_ambient').prop('muted'));
    $('#audio_ambient_mute').toggleClass('redOverlayGlow');
    saveSettingsDebounced();
}

async function onBGMVolumeChange() {
    extension_settings.audio.bgm_volume = ~~($('#audio_bgm_volume_slider').val());
    $('#audio_bgm').prop('volume', extension_settings.audio.bgm_volume * 0.01);
    $('#audio_bgm_volume').text(extension_settings.audio.bgm_volume);
    saveSettingsDebounced();
    //console.debug(DEBUG_PREFIX,"UPDATED BGM MAX TO",extension_settings.audio.bgm_volume);
}

async function onAmbientVolumeChange() {
    extension_settings.audio.ambient_volume = ~~($('#audio_ambient_volume_slider').val());
    $('#audio_ambient').prop('volume', extension_settings.audio.ambient_volume * 0.01);
    $('#audio_ambient_volume').text(extension_settings.audio.ambient_volume);
    saveSettingsDebounced();
    //console.debug(DEBUG_PREFIX,"UPDATED Ambient MAX TO",extension_settings.audio.ambient_volume);
}

async function onBGMSelectChange() {
    extension_settings.audio.bgm_selected = $('#audio_bgm_select').val();
    updateBGM(true);
    saveSettingsDebounced();
    //console.debug(DEBUG_PREFIX,"UPDATED BGM MAX TO",extension_settings.audio.bgm_volume);
}

async function onAmbientSelectChange() {
    extension_settings.audio.ambient_selected = $('#audio_ambient_select').val();
    updateAmbient(true);
    saveSettingsDebounced();
    //console.debug(DEBUG_PREFIX,"UPDATED BGM MAX TO",extension_settings.audio.bgm_volume);
}

async function onBGMCooldownInput() {
    extension_settings.audio.bgm_cooldown = ~~($('#audio_bgm_cooldown').val());
    cooldownBGM = extension_settings.audio.bgm_cooldown * 1000;
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'UPDATED BGM cooldown to', extension_settings.audio.bgm_cooldown);
}

//#############################//
//  ADUIO / UI                 //
//#############################//

async function onAudioUIMuteClick(e) {
    console.log('onAudioUIMuteClick');
    extension_settings.audio.audioui_muted = !extension_settings.audio.audioui_muted;
    $('#audio_ui_mute_icon').toggleClass('fa-volume-high');
    $('#audio_ui_mute_icon').toggleClass('fa-volume-mute');
    $('#audio_ui').prop('muted', !$('#audio_ui').prop('muted'));
    $('#audio_ui_mute').toggleClass('redOverlayGlow');
    saveSettingsDebounced();
}
async function toggleAudioUIMuteButton(b) {
    if (b) {
        $('#audio_ui_mute_icon').removeClass('fa-volume-high');
        $('#audio_ui_mute_icon').addClass('fa-volume-mute');
        $('#audio_ui_mute').addClass('redOverlayGlow');
        $('#audio_ui').prop('muted', true);
    } else {
        $('#audio_ui_mute_icon').addClass('fa-volume-high');
        $('#audio_ui_mute_icon').removeClass('fa-volume-mute');
        $('#audio_ui_mute').removeClass('redOverlayGlow');
        $('#audio_ui').prop('muted', false);
    }
}

async function onAudioUILockClick(e) {
}

//#############################//
//  API Calls                  //
//#############################//

async function getAssetsList(type) {
    console.debug(DEBUG_PREFIX, 'getting assets of type', type);

    try {
        const result = await fetch('/api/assets/get', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        const assets = result.ok ? (await result.json()) : { type: [] };
        console.debug(DEBUG_PREFIX, 'Found assets:', assets);

        const output = assets[type];
        for(const i in output) {
            output[i] = output[i].replaceAll('\\','/');
            console.debug(DEBUG_PREFIX,'DEBUG',output[i]);
        }

        return output;
    }
    catch (err) {
        console.log(err);
        return [];
    }
}

async function getCharacterBgmList(name) {
    console.debug(DEBUG_PREFIX, 'getting bgm list for', name);

    try {
        const result = await fetch(`/api/assets/character?name=${encodeURIComponent(name)}&category=${CHARACTER_BGM_FOLDER}`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        let musics = result.ok ? (await result.json()) : [];
        return musics;
    }
    catch (err) {
        console.log(err);
        return [];
    }
}

//#############################//
//  Module Worker              //
//#############################//

function fillBGMSelect() {
    let found_last_selected_bgm = false;
    // Update bgm list in UI
    $('#audio_bgm_select')
        .find('option')
        .remove();

    for (const file of fallback_BGMS) {
        $('#audio_bgm_select').append(new Option('asset: ' + file.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, ''), file));
        if (file === extension_settings.audio.bgm_selected) {
            $('#audio_bgm_select').val(extension_settings.audio.bgm_selected);
            found_last_selected_bgm = true;
        }
    }

    // Update bgm list in UI
    for (const char in characterMusics)
        for (const e in characterMusics[char])
            for (const file of characterMusics[char][e]) {
                $('#audio_bgm_select').append(new Option(char + ': ' + file.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, ''), file));
                if (file === extension_settings.audio.bgm_selected) {
                    $('#audio_bgm_select').val(extension_settings.audio.bgm_selected);
                    found_last_selected_bgm = true;
                }
            }

    if (!found_last_selected_bgm) {
        $('#audio_bgm_select').val($('#audio_bgm_select option:first').val());
        extension_settings.audio.bgm_selected = null;
    }
}

/*
    - Update ambient sound
    - Update character BGM
        - Solo dynamique expression
        - Group only neutral bgm
*/
async function moduleWorker() {
    const moduleEnabled = extension_settings.audio.enabled;

    if (moduleEnabled) {

        if (cooldownBGM > 0)
            cooldownBGM -= UPDATE_INTERVAL;

        if (fallback_BGMS == null) {
            console.debug(DEBUG_PREFIX, 'Updating audio bgm assets...');
            fallback_BGMS = await getAssetsList(ASSETS_BGM_FOLDER);
            fallback_BGMS = fallback_BGMS.filter((filename) => filename != '.placeholder');
            console.debug(DEBUG_PREFIX, 'Detected assets:', fallback_BGMS);

            fillBGMSelect();
        }

        if (ambients == null) {
            console.debug(DEBUG_PREFIX, 'Updating audio ambient assets...');
            ambients = await getAssetsList(ASSETS_AMBIENT_FOLDER);
            ambients = ambients.filter((filename) => filename != '.placeholder');
            console.debug(DEBUG_PREFIX, 'Detected assets:', ambients);

            // Update bgm list in UI
            $('#audio_ambient_select')
                .find('option')
                .remove();

            if (extension_settings.audio.ambient_selected !== null) {
                let ambient_label = extension_settings.audio.ambient_selected;
                if (ambient_label.includes('assets'))
                    ambient_label = 'asset: ' + ambient_label.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, '');
                else {
                    ambient_label = ambient_label.substring('/characters/'.length);
                    ambient_label = ambient_label.substring(0, ambient_label.indexOf('/')) + ': ' + ambient_label.substring(ambient_label.indexOf('/') + '/bgm/'.length);
                    ambient_label = ambient_label.replace(/\.[^/.]+$/, '');
                }
                $('#audio_ambient_select').append(new Option(ambient_label, extension_settings.audio.ambient_selected));
            }

            for (const file of ambients) {
                if (file !== extension_settings.audio.ambient_selected)
                    $('#audio_ambient_select').append(new Option('asset: ' + file.replace(/^.*[\\\/]/, '').replace(/\.[^/.]+$/, ''), file));
            }
        }

        // 1) Update ambient audio
        // ---------------------------
        //if (extension_settings.audio.dynamic_ambient_enabled) {
        let newBackground = $('#bg1').css('background-image');
        const custom_background = getContext()['chatMetadata']['custom_background'];

        if (custom_background !== undefined)
            newBackground = custom_background;

        if (!isDataURL(newBackground)) {
            newBackground = newBackground.substring(newBackground.lastIndexOf('/') + 1).replace(/\.[^/.]+$/, '').replaceAll('%20', '-').replaceAll(' ', '-'); // remove path and spaces

            //console.debug(DEBUG_PREFIX,"Current backgroung:",newBackground);

            if (currentBackground !== newBackground) {
                currentBackground = newBackground;

                console.debug(DEBUG_PREFIX, 'Changing ambient audio for', currentBackground);
                updateAmbient();
            }
        }
        //}

        const context = getContext();
        //console.debug(DEBUG_PREFIX,context);

        if (context.chat.length == 0)
            return;

        let chatIsGroup = context.chat[0].is_group;
        let newCharacter = null;

        // 1) Update BGM (single chat)
        // -----------------------------
        if (!chatIsGroup) {

            // Reset bgm list on new chat
            if (context.chatId != current_chat_id) {
                current_chat_id = context.chatId;
                characterMusics = {};
                cooldownBGM = 0;
            }

            newCharacter = context.name2;

            //console.log(DEBUG_PREFIX,"SOLO CHAT MODE"); // DBG

            // 1.1) First time loading chat
            if (characterMusics[newCharacter] === undefined) {
                await loadCharacterBGM(newCharacter);
                currentExpressionBGM = FALLBACK_EXPRESSION;
                //currentCharacterBGM = newCharacter;

                //updateBGM();
                //cooldownBGM = BGM_UPDATE_COOLDOWN;
                return;
            }

            // 1.2) Switched chat
            if (currentCharacterBGM !== newCharacter) {
                currentCharacterBGM = newCharacter;
                try {
                    await updateBGM(false, true);
                    cooldownBGM = extension_settings.audio.bgm_cooldown * 1000;
                }
                catch (error) {
                    console.debug(DEBUG_PREFIX, 'Error while trying to update BGM character, will try again');
                    currentCharacterBGM = null;
                }
                return;
            }

            const newExpression = getNewExpression();

            // 1.3) Same character but different expression
            if (currentExpressionBGM !== newExpression) {

                // Check cooldown
                if (cooldownBGM > 0) {
                    //console.debug(DEBUG_PREFIX,"(SOLO) BGM switch on cooldown:",cooldownBGM);
                    return;
                }

                try {
                    currentExpressionBGM = newExpression;
                    await updateBGM();
                    cooldownBGM = extension_settings.audio.bgm_cooldown * 1000;
                    console.debug(DEBUG_PREFIX, '(SOLO) Updated current character expression to', currentExpressionBGM, 'cooldown', cooldownBGM);
                }
                catch (error) {
                    console.debug(DEBUG_PREFIX, 'Error while trying to update BGM expression, will try again');
                    currentCharacterBGM = null;
                }
                return;
            }

            return;
        }

        // 2) Update BGM (group chat)
        // -----------------------------

        // Load current chat character bgms
        // Reset bgm list on new chat
        if (context.chatId != current_chat_id) {
            current_chat_id = context.chatId;
            characterMusics = {};
            cooldownBGM = 0;
            for (const message of context.chat) {
                if (characterMusics[message.name] === undefined)
                    await loadCharacterBGM(message.name);
            }

            try {
                newCharacter = context.chat[context.chat.length - 1].name;
                currentCharacterBGM = newCharacter;
                await updateBGM(false, true);
                cooldownBGM = extension_settings.audio.bgm_cooldown * 1000;
                currentCharacterBGM = newCharacter;
                currentExpressionBGM = FALLBACK_EXPRESSION;
                console.debug(DEBUG_PREFIX, '(GROUP) Updated current character BGM to', currentExpressionBGM, 'cooldown', cooldownBGM);
            }
            catch (error) {
                console.debug(DEBUG_PREFIX, 'Error while trying to update BGM group, will try again');
                currentCharacterBGM = null;
            }
            return;
        }

        newCharacter = context.chat[context.chat.length - 1].name;
        const userName = context.name1;

        if (newCharacter !== undefined && newCharacter != userName) {

            //console.log(DEBUG_PREFIX,"GROUP CHAT MODE"); // DBG

            // 2.1) New character appear
            if (characterMusics[newCharacter] === undefined) {
                await loadCharacterBGM(newCharacter);
                return;
            }

            // 2.2) Switched char
            if (currentCharacterBGM !== newCharacter) {
                // Check cooldown
                if (cooldownBGM > 0) {
                    console.debug(DEBUG_PREFIX, '(GROUP) BGM switch on cooldown:', cooldownBGM);
                    return;
                }

                try {
                    currentCharacterBGM = newCharacter;
                    await updateBGM();
                    cooldownBGM = extension_settings.audio.bgm_cooldown * 1000;
                    currentCharacterBGM = newCharacter;
                    currentExpressionBGM = FALLBACK_EXPRESSION;
                    console.debug(DEBUG_PREFIX, '(GROUP) Updated current character BGM to', currentExpressionBGM, 'cooldown', cooldownBGM);
                }
                catch (error) {
                    console.debug(DEBUG_PREFIX, 'Error while trying to update BGM group, will try again');
                    currentCharacterBGM = null;
                }
                return;
            }

            /*
            const newExpression = getNewExpression();

            // 1.3) Same character but different expression
            if (currentExpressionBGM !== newExpression) {

                // Check cooldown
                if (cooldownBGM > 0) {
                    console.debug(DEBUG_PREFIX,"BGM switch on cooldown:",cooldownBGM);
                    return;
                }

                cooldownBGM = BGM_UPDATE_COOLDOWN;
                currentExpressionBGM = newExpression;
                console.debug(DEBUG_PREFIX,"Updated current character expression to",currentExpressionBGM);
                updateBGM();
                return;
            }

            return;*/

        }

        // Case 3: Same character/expression or BGM switch on cooldown keep playing same BGM
        //console.debug(DEBUG_PREFIX,"Nothing to do for",currentCharacterBGM, newCharacter, currentExpressionBGM, cooldownBGM);
    }
}

async function loadCharacterBGM(newCharacter) {
    console.debug(DEBUG_PREFIX, 'New character detected, loading BGM folder of', newCharacter);

    // 1.1) First time character appear, load its music folder
    const audio_file_paths = await getCharacterBgmList(newCharacter);
    //console.debug(DEBUG_PREFIX, "Recieved", audio_file_paths);

    // Initialise expression/files mapping
    characterMusics[newCharacter] = {};
    for (const e of DEFAULT_EXPRESSIONS)
        characterMusics[newCharacter][e] = [];

    for (const i of audio_file_paths) {
        //console.debug(DEBUG_PREFIX,"File found:",i);
        for (const e of DEFAULT_EXPRESSIONS)
            if (i.includes(e))
                characterMusics[newCharacter][e].push(i);
    }
    console.debug(DEBUG_PREFIX, 'Updated BGM map of', newCharacter, 'to', characterMusics[newCharacter]);

    fillBGMSelect();
}

function getNewExpression() {
    let newExpression;

    // HACK: use sprite file name as expression detection
    if (!$(SPRITE_DOM_ID).length) {
        console.error(DEBUG_PREFIX, 'ERROR: expression sprite does not exist, cannot extract expression from ', SPRITE_DOM_ID);
        return FALLBACK_EXPRESSION;
    }

    const spriteFile = $('#expression-image').attr('src');
    newExpression = spriteFile.substring(spriteFile.lastIndexOf('/') + 1).replace(/\.[^/.]+$/, '');
    //

    // No sprite to detect expression
    if (newExpression == '') {
        //console.info(DEBUG_PREFIX,"Warning: no expression extracted from sprite, switch to",FALLBACK_EXPRESSION);
        newExpression = FALLBACK_EXPRESSION;
    }

    if (!DEFAULT_EXPRESSIONS.includes(newExpression)) {
        console.info(DEBUG_PREFIX, 'Warning:', newExpression, ' is not a handled expression, expected one of', FALLBACK_EXPRESSION);
        return FALLBACK_EXPRESSION;
    }

    return newExpression;
}

async function updateBGM(isUserInput = false, newChat = false) {
    if (!isUserInput && !extension_settings.audio.dynamic_bgm_enabled && $('#audio_bgm').attr('src') != '' && !bgmEnded && !newChat) {
        console.debug(DEBUG_PREFIX, 'BGM already playing and dynamic switch disabled, no update done');
        return;
    }

    let audio_file_path = '';
    if (isUserInput || (extension_settings.audio.bgm_locked && extension_settings.audio.bgm_selected !== null)) {
        audio_file_path = extension_settings.audio.bgm_selected;

        if (isUserInput)
            console.debug(DEBUG_PREFIX, 'User selected BGM', audio_file_path);
        if (extension_settings.audio.bgm_locked)
            console.debug(DEBUG_PREFIX, 'BGM locked keeping current audio', audio_file_path);
    }
    else {

        let audio_files = null;

        if (extension_settings.audio.dynamic_bgm_enabled) {
            extension_settings.audio.bgm_selected = null;
            saveSettingsDebounced();
            audio_files = characterMusics[currentCharacterBGM][currentExpressionBGM];// Try char expression BGM

            if (audio_files === undefined || audio_files.length == 0) {
                console.debug(DEBUG_PREFIX, 'No BGM for', currentCharacterBGM, currentExpressionBGM);
                audio_files = characterMusics[currentCharacterBGM][FALLBACK_EXPRESSION]; // Try char FALLBACK BGM
                if (audio_files === undefined || audio_files.length == 0) {
                    console.debug(DEBUG_PREFIX, 'No default BGM for', currentCharacterBGM, FALLBACK_EXPRESSION, 'switch to ST BGM');
                    audio_files = fallback_BGMS; // ST FALLBACK BGM

                    if (audio_files.length == 0) {
                        console.debug(DEBUG_PREFIX, 'No default BGM file found, bgm folder may be empty.');
                        return;
                    }
                }
            }
        }
        else {
            audio_files = [];
            $('#audio_bgm_select option').each(function () { audio_files.push($(this).val()); });
        }

        audio_file_path = audio_files[Math.floor(Math.random() * audio_files.length)];
    }

    console.log(DEBUG_PREFIX, 'Updating BGM');
    console.log(DEBUG_PREFIX, 'Checking file', audio_file_path);
    try {
        const response = await fetch(audio_file_path);

        if (!response.ok) {
            console.log(DEBUG_PREFIX, 'File not found!');
        }
        else {
            console.log(DEBUG_PREFIX, 'Switching BGM to', currentExpressionBGM);
            $('#audio_bgm_select').val(audio_file_path);
            const audio = $('#audio_bgm');

            if (audio.attr('src') == audio_file_path && !bgmEnded) {
                console.log(DEBUG_PREFIX, 'Already playing, ignored');
                return;
            }

            let fade_time = 2000;
            bgmEnded = false;

            if (isUserInput || extension_settings.audio.bgm_locked) {
                audio.attr('src', audio_file_path);
                audio.prop('volume', extension_settings.audio.bgm_volume * 0.01);
                audio[0].play();
            }
            else {
                audio.animate({ volume: 0.0 }, fade_time, function () {
                    audio.attr('src', audio_file_path);
                    audio[0].play();
                    audio.prop('volume', extension_settings.audio.bgm_volume * 0.01);
                    audio.animate({ volume: extension_settings.audio.bgm_volume * 0.01 }, fade_time);
                });
            }
        }

    } catch (error) {
        console.log(DEBUG_PREFIX, 'Error while trying to fetch', audio_file_path, ':', error);
    }
}

async function updateAmbient(isUserInput = false) {
    let audio_file_path = null;

    if (isUserInput || extension_settings.audio.ambient_locked) {
        audio_file_path = extension_settings.audio.ambient_selected;

        if (isUserInput)
            console.debug(DEBUG_PREFIX, 'User selected Ambient', audio_file_path);
        if (extension_settings.audio.bgm_locked)
            console.debug(DEBUG_PREFIX, 'Ambient locked keeping current audio', audio_file_path);
    }
    else {
        extension_settings.audio.ambient_selected = null;
        for (const i of ambients) {
            console.debug(i);
            if (i.includes(currentBackground)) {
                audio_file_path = i;
                break;
            }
        }
    }

    if (audio_file_path === null) {
        console.debug(DEBUG_PREFIX, 'No bgm file found for background', currentBackground);
        const audio = $('#audio_ambient');
        audio.attr('src', '');
        audio[0].pause();
        return;
    }

    //const audio_file_path = AMBIENT_FOLDER+currentBackground+".mp3";
    console.log(DEBUG_PREFIX, 'Updating ambient');
    console.log(DEBUG_PREFIX, 'Checking file', audio_file_path);
    $('#audio_ambient_select').val(audio_file_path);

    let fade_time = 2000;
    if (isUserInput)
        fade_time = 0;

    const audio = $('#audio_ambient');

    if (audio.attr('src') == audio_file_path) {
        console.log(DEBUG_PREFIX, 'Already playing, ignored');
        return;
    }

    audio.animate({ volume: 0.0 }, fade_time, function () {
        audio.attr('src', audio_file_path);
        audio[0].play();
        audio.prop('volume', extension_settings.audio.ambient_volume * 0.01);
        audio.animate({ volume: extension_settings.audio.ambient_volume * 0.01 }, fade_time);
    });
}

/**
 * Handles wheel events on volume sliders.
 * @param {WheelEvent} e Event
 */
function onVolumeSliderWheelEvent(e) {
    const slider = $(this);
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY / 20;
    const sliderVal = Number(slider.val());

    let newVal = sliderVal - delta;
    if (newVal < 0) {
        newVal = 0;
    } else if (newVal > 100) {
        newVal = 100;
    }

    slider.val(newVal).trigger('input');
}

//#############################//
//  Extension load             //
//#############################//

// This function is called when the extension is loaded

const tryCatch = (fn, fallback) => {
    try {
        return fn();
    } catch (e) {
        return fallback(e);
    }
}
jQuery(async () => {
    const windowHtml = $(await $.get(`${extensionFolderPath}/window.html`));

    $('#extensions_settings').append(windowHtml);
    loadSettings();

    $('#audio_enabled').on('click', onEnabledClick);
    $('#audio_dynamic_bgm_enabled').on('click', onDynamicBGMEnabledClick);
    //$("#audio_dynamic_ambient_enabled").on("click", onDynamicAmbientEnabledClick);

    //$("#audio_bgm").attr("loop", false);
    $('#audio_ambient').attr('loop', "true");


    let audiouiclick = new UIInteractions();

    // is there a saved pack?
    if (extension_settings.audio.ui_pack) {
        const pack = await packmanager.getManifest(extension_settings.audio.ui_pack);
        console.log('saved pack', pack);
        // does the pack have any keys?
        if (pack && Object.keys(pack).length > 0) {
            $(".audio_ui_selected_pack").text(pack.name);

            audiouiclick.setPack({
                name: pack.name,
                multiSoundsClicks: pack.click_behaviour == "multiple" ? true : false,
                multiSoundsHover: pack.hover_behaviour == "multiple" ? true : false,
                assetsClick: pack.files_onclick || [],
                assetsHover: pack.files_onhover || [],
                folder: pack.folder,
                click: pack.file_onclick,
                hover: pack.file_onhover,
            });
            $(".audio_ui_selected_pack_icon").css("background-image", `url(${pack.icon})`);
        }
    } else {
        console.log('no saved pack');
        extension_settings.audio.ui_pack = "base";
        saveSettingsDebounced();
        const modal = new modalCreator(
            'reload-window',
            'Reloading in 10 second',
            $(`<div><p>Settings have been updated, the UI interactions sound pack has been set to "base".</p></div>`),
            $(`<div>
                <div class="menu_button" id="modal-reload"
                    style="height: min-content; width:max-content;"
                >Reload now</div>
            </div>`),
            {}
        );
        modal.create();
        modal.show();

        $(`#${modal.id} #modal-reload`).on('click', () => {
            window.location.reload();
        });

        setTimeout(() => {
            window.location.reload();
        }, 10000);
    }
    audiouiclick.init();
    if (extension_settings.audio.ui_click_muted) {
        audiouiclick.audioClick.muted = true;
    }
    if (extension_settings.audio.ui_hover_muted) {
        audiouiclick.audioHover.muted = true;
    }

    tryCatch(
        () => audiouiclick.setVolume(extension_settings.audio.ui_volume * 0.01),
        (e) => {
            console.error('Error setting volume', e)
            audiouiclick.setVolume(0.5);
        }
    )


    $('#audio_bgm').hide();
    $('#audio_bgm_lock').on('click', onBGMLockClick);
    $('#audio_bgm_mute').on('click', onBGMMuteClick);
    $('#audio_bgm_volume_slider').on('input', onBGMVolumeChange);
    $('#audio_bgm_random').on('click', onBGMRandomClick);

    $('#audio_ambient').hide();
    $('#audio_ambient_lock').on('click', onAmbientLockClick);
    $('#audio_ambient_mute').on('click', onAmbientMuteClick);
    $('#audio_ambient_volume_slider').on('input', onAmbientVolumeChange);

    $('#audio_ui').hide();
    $('#audio_ui_volume_slider').on('input', (e) => {
        audiouiclick.audioClick.currentTime = 0;
        audiouiclick.audioClick.play();
        audiouiclick.setVolume($('#audio_ui_volume_slider').val() * 0.01);
        extension_settings.audio.ui_volume = $('#audio_ui_volume_slider').val();
        saveSettingsDebounced();
    });

    $('#audio_ui_config').on('click', async (e) => {
        const m = new modalCreator(
            "config-ui-interactions",
            "UI Interactions",
            $(`<div class="style-config-ui-interactions">
                ${
                    extension_settings.audio.enabled == false ? `<div class="config-section" style="background-color: #fff00055; color: #fff;">
                    <p style="margin: 10px; margin-bottom: 10px; padding: 0; font-size: 1.5em; font-weight: bold;"
                    >Enable Dynamic Audio to have UI interactions sounds</p>
                    <p style="margin: 0; margin-left: 10px; margin-bottom: 10px;">Preview audio are still enabled</p>
                </div>` : ''
                }
                <div class="config-section">
                    <div id="config-section-curr-pack" class="config-row config-row-last" style="display: flex; align-items: flex-start; justify-content: space-between;">
                        <div id="config-ui-curr-pack" style="width: 100%;">
                            <h3
                                style="margin:0; margin-bottom: 10px;"
                            >Selected Pack</h3>
                            <div class="config-input" style="display:flex; gap:10px;">
                                <div class="menu_button" id="refresh-ui-pack"
                                    style="width: 20%; margin: 0; min-width: 100px;"
                                >Refresh</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="config-section special-style-config-sound-settings">
                    <style>
                        .special-style-config-sound-settings p {
                            margin: 0;
                        }

                        .special-style-config-sound-settings .config-sound-onclick,
                        .special-style-config-sound-settings .config-sound-onhover {
                            display: flex; align-items: center; gap: 10px;
                        }
                    </style>
                    <p style="margin: 10px; margin-bottom: 10px; padding: 0; font-size: 1.5em; font-weight: bold;"
                    >Sound Settings</p>
                    <div class="config-row config-row-last" style="display: flex; align-items: flex-start; justify-content: flex-start;">
                        <div>
                            <h4>Sound on click and hover</h4>
                            <div class="config-sound-onclick">
                                <button class="menu_button config-ui-mute-click" id="mute-sound-onclick" style="font-size: 1.2em; width: 32px; height: 32px; display: flex;">
                                    <i class="mute-icon fas fa-volume-high"></i>
                                </button>
                                <p>on click</p>
                            </div>
                            <div class="config-sound-onhover">
                                <button class="menu_button config-ui-mute-hover" id="mute-sound-onhover" style="font-size: 1.2em; width: 32px; height: 32px; display: flex">
                                    <i class="mute-icon fas fa-volume-high"></i>
                                </button>
                                <p>on hover</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="config-section">
                    <p style="margin: 10px; margin-bottom: 10px; padding: 0; font-size: 1.5em; font-weight: bold;"
                    >Pack information</p>
                    <div id="config-section-pack-info" class="config-row config-row-last" style="display: flex; align-items: flex-start; justify-content: space-between;">
                        <div id="config-pack-info" style="width: 100%;" class="config-input">
                        </div>
                    </div>
                </div>
            </div>`),
            $(`<div style="display: flex; justify-content: center; align-items: center; width: 100%; gap: 10px;">
                <div class="menu_button" id="modal-save"
                    style="height: min-content; width:max-content; display: none;"
                >Save and apply</div>
                <div class="menu_button" id="modal-close">Close</div>
            </div>`),
            {
                class: "modal-exlg",
                style: "height: 100%"
            }
        )

        m.create();
        m.show();

        let manifests = new Map();

        // pack info
        const pack_info = new UIInteractions_PackInfo();
        $(`#${m.id} #config-section-pack-info #config-pack-info`).html(pack_info.draw());

        $(`#${m.id} #modal-close`).on('click', () => {
            console.log('close');
            modalAPI.removeModal(m.id);
        });

        $(`#${m.id} #refresh-ui-pack`).on('click', async () => {
            await refresh();
        });

        // mute buttons
        $(`#${m.id} #mute-sound-onclick`).on('click', async (e) => {
            audiouiclick.audioClick.currentTime = 0;
            const i = $(`#${m.id} #mute-sound-onclick .mute-icon`);

            if (audiouiclick.audioClick.muted) {
                audiouiclick.audioClick.muted = false;
                i.removeClass('fa-volume-mute redOverlayGlow').addClass('fa-volume-high');
            } else {
                audiouiclick.audioClick.muted = true;
                i.removeClass('fa-volume-high').addClass('fa-volume-mute redOverlayGlow');
            }

            extension_settings.audio.ui_click_muted = audiouiclick.audioClick.muted;
            saveSettingsDebounced();
        });

        $(`#${m.id} #mute-sound-onhover`).on('click', async (e) => {
            audiouiclick.audioHover.currentTime = 0;
            const i = $(`#${m.id} #mute-sound-onhover .mute-icon`);

            if (audiouiclick.audioHover.muted) {
                audiouiclick.audioHover.muted = false;
                i.removeClass('fa-volume-mute redOverlayGlow').addClass('fa-volume-high');
            } else {
                audiouiclick.audioHover.muted = true;
                i.removeClass('fa-volume-high').addClass('fa-volume-mute redOverlayGlow');
            }

            extension_settings.audio.ui_hover_muted = audiouiclick.audioHover.muted;
            saveSettingsDebounced();
        })

        if (extension_settings.audio.ui_click_muted) {
            const i = $(`#${m.id} #mute-sound-onclick .mute-icon`);
            i.removeClass('fa-volume-high').addClass('fa-volume-mute redOverlayGlow');
        }
        if (extension_settings.audio.ui_hover_muted) {
            const i = $(`#${m.id} #mute-sound-onhover .mute-icon`);
            i.removeClass('fa-volume-high').addClass('fa-volume-mute redOverlayGlow');
        }

        const asset_pack = new dropdown('config-current-pack')
        asset_pack.setItems([
            { value: 'none', text: 'Select' },
        ]);
        $(`#${m.id} #config-section-curr-pack #config-ui-curr-pack .config-input`)
            .prepend(asset_pack.draw());
        asset_pack.init();

        const refresh = async () => {
            asset_pack.setItems([
                { value: 'none', text: 'Select' },
            ]);
            asset_pack.setValue('none');
            pack_info.clear()
            pack_info.root.shadowRoot.querySelector('.pack-info .header h2').innerText = 'Loading...';
            manifests.clear();
            $(`#${m.id} #modal-save`).css('display', 'none');

            (await packmanager.getAssetsList()).forEach(async (pack) => {
                let folder = String(pack).replace(/\\/g, '/');
                folder = folder.substring(folder.lastIndexOf('/') + 1);
                manifests.set(folder, await packmanager.getManifest(folder));
                const name = manifests.get(folder).name;
                asset_pack.addItem({
                    value: folder,
                    text: name,
                });

                if (extension_settings.audio.ui_pack === folder) {
                    asset_pack.setValue(extension_settings.audio.ui_pack);
                }
            });
        }
        asset_pack.on('change', async (e) =>  {
            pack_info.clear();
            // name to "loading..."
            if (asset_pack.value === 'none') {
                $(`#${m.id} #modal-save`).css('display', 'none');
                pack_info.setManifest(null)
                return;
            }
            $(`#${m.id} #modal-save`).css('display', 'block'); pack_info.setManifest(await manifests.get(asset_pack.value));
        });

        try {
            await refresh();
        } catch (e) {
            pack_info.root.shadowRoot.querySelector('.pack-info .header h2').innerText = 'Error loading packs';
            console.error('Error refreshing packs', e);
            $(`#${m.id} #modal-save`).css('display', 'none');
            $(`#${m.id} #refresh-ui-pack`).css('display', 'none');
        }

        $(`#${m.id} #modal-save`).on('click', async () => {
            console.log('Saving pack', asset_pack.value);
            extension_settings.audio.ui_pack = asset_pack.value;
            await saveSettingsDebounced();
            const p = await packmanager.getManifest(asset_pack.value);

            if (p === null || Object.keys(p).length === 0) {
                console.error('No pack selected');
                return;
            }

            $(`#${m.id} #modal-save`).css('display', 'none');
            $(`#${m.id} #modal-close`).css('display', 'none');

            const modal = new modalCreator(
                'reload-window',
                'Reloading in 1 second',
                $(`<div><p>Reloading window to apply changes</p></div>`),
                $(`<div></div>`),
                {}
            );
            modal.create();
            modal.show();

            setTimeout(() => {
                window.location.reload();
            }, 1000);
        });
    });

    document.getElementById('audio_ambient_volume_slider').addEventListener('wheel', onVolumeSliderWheelEvent, { passive: false });
    document.getElementById('audio_bgm_volume_slider').addEventListener('wheel', onVolumeSliderWheelEvent, { passive: false });
    document.getElementById('audio_ui_volume_slider').addEventListener('wheel', onVolumeSliderWheelEvent, { passive: false });

    $('#audio_bgm_cooldown').on('input', onBGMCooldownInput);

    // Reset assets container, will be redected like if ST restarted
    $('#audio_refresh_assets').on('click', function () {
        console.debug(DEBUG_PREFIX, 'Refreshing audio assets');
        current_chat_id = null;
        fallback_BGMS = null;
        ambients = null;
        characterMusics = {};
        currentCharacterBGM = null;
        currentExpressionBGM = null;
        currentBackground = null;
    });

    $('#audio_bgm_select').on('change', onBGMSelectChange);
    $('#audio_ambient_select').on('change', onAmbientSelectChange);

    // DBG
    $('#audio_debug').on('click', function () {
        if ($('#audio_debug').is(':checked')) {
            $('#audio_bgm').show();
            $('#audio_ambient').show();
        }
        else {
            $('#audio_bgm').hide();
            $('#audio_ambient').hide();
        }
    });
    //

    $('#audio_bgm').on('ended', function () {
        console.debug(DEBUG_PREFIX, 'END OF BGM');
        if (!extension_settings.audio.bgm_locked) {
            bgmEnded = true;
            updateBGM();
        }
    });

    const wrapper = new ModuleWorkerWrapper(moduleWorker);
    setInterval(wrapper.update.bind(wrapper), UPDATE_INTERVAL);
    moduleWorker();

    registerSlashCommand('music', setBGMSlashCommand, ['bgm'], '<span class="monospace">(file path)</span> – force change of bgm for given file', true, true);
    registerSlashCommand('ambient', setAmbientSlashCommand, [], '<span class="monospace">(file path)</span> – force change of ambient audio for given file', true, true);
});

async function setBGMSlashCommand(_, file) {
    if (!file) {
        console.log('No bgm file provided');
        return;
    }

    file = file.trim().toLowerCase();

    // Fuzzy search for sprite

    let selectElement = document.querySelectorAll('[id=audio_bgm_select]');
    let optionValues = [...selectElement[0].options].map(o => o.value);
    //console.debug(DEBUG_PREFIX,"DEBUG:",optionValues);

    const fuse = new Fuse(optionValues);
    const results = fuse.search(file);
    const fileItem = results[0]?.item;

    if (!fileItem) {
        console.log('Bgm file path not valid');
        return;
    }

    $('#audio_bgm_select').val(fileItem);
    onBGMSelectChange();
}

async function setAmbientSlashCommand(_, file) {
    if (!file) {
        console.log('No ambient file provided');
        return;
    }

    file = file.trim().toLowerCase();

    let selectElement = document.querySelectorAll('[id=audio_ambient_select]');
    let optionValues = [...selectElement[0].options].map(o => o.value);
    //console.debug(DEBUG_PREFIX,"DEBUG:",optionValues);

    const fuse = new Fuse(optionValues);
    const results = fuse.search(file);
    const fileItem = results[0]?.item;

    if (!fileItem) {
        console.log('Bgm file path not valid');
        return;
    }

    $('#audio_ambient_select').val(fileItem);
    // audiouiclick.audio.src = 'assets/sfx/fard.mp3';
}

"use strict"
// MODAL CONTROLLER
// =============================================================================

const modalmap = new Map()
let modalContainer = $('#modal-container[for-extension="dynamic-audio"]')
if (modalContainer.length === 0) {
    console.log('Modal container does not exist, creating it')
    // prepend the modal container to the body
    $('body').prepend('<div id="modal-container" for-extension="dynamic-audio"></div>')
    modalContainer = $('#modal-container[for-extension="dynamic-audio"]')
}

const createModal = function (id, title, body, footer, settings) {
    const randomid = Math.random().toString(36).substring(7);
    const modal = $(`
    <div class="modal-wrapper">
        <div class="modal ${settings && settings.class || ""}" id="${id}-${randomid}" tabindex="-1" >
            <div class="header">
                <div class="title"><span ${ settings && settings.title_i18n ? `data-i18n="${settings.title_i18n}"` : ''}	>${title}</span></div>
                ${ settings && settings.showclosebutton ? ` <div class="close"><span>&times;</span></div>` : ''}
            </div>
            <div class="content"><div class="inner">${body.prop("outerHTML")}</div></div>
            ${ footer ? `<div class="footer">${footer.prop("outerHTML")}</div>` : ''}
        </div>
    </div>
    `);
    if (settings && settings.showclosebutton) {
        modal.find('.close').click(() => {
            modalAPI.removeModal(`${id}-${randomid}`)
        })
    }
    return {
        id: `${id}-${randomid}`,
        modal: modal,
    }
}
class modalCreator {
    id = null; title = null; body = null; footer = null; settings = null
    /**
     * @param {string} id
     * @param {string} title
     * @param {any} body
     * @param {any} footer
     * @param {*} settings
     */
    constructor(id, title, body, footer, settings) {
        this.id = id;this.title = title;this.body = body;this.footer = footer;this.settings = settings
        if (typeof this.settings !== 'object') {throw new Error('Settings must be an object')}

        // does the modal-container exist?
    }
    create() {
        const modal = createModal(this.id, this.title, this.body, this.footer, this.settings);
        this.id = modal.id;
        modalAPI.addModal(this.id, modal.modal);
        return modal}
    show() {modalAPI.showModal(this.id)}
    hide() {modalAPI.hideModal(this.id)}
}

// Basics
const modalAPI = {
    show: function() {modalContainer.addClass('show');modalContainer.removeClass('hide');},
    hide: function() {modalContainer.removeClass('show');modalContainer.addClass('hide');},
    addModal: function (id, modal) {if (modalmap.has(id)) {modalAPI.removeModal(id)}modalmap.set(id, modal)},
    removeModal: function (id) {modalAPI.hideModal(id);modalmap.delete(id);},
    showModal: function (id) {
        $("body").css("overflow", "hidden");
        // check if modal exists
        const modal = modalmap.get(id)
        if (typeof modal === 'undefined') {
            throw new Error('Modal does not exist')
        }
        modalContainer.append(modal)
        modalContainer.addClass('show')
        $('body').addClass('modal-open')
        setTimeout(() => {
            modal.addClass('active')
        }, 100);
    },
    hideModal: function (id) {
        if (!modalmap.has(id)) {
            throw new Error('Modal does not exist')
        }
        const modal = modalmap.get(id)
        modal.removeClass('active')
        // check if there is any other modal open
        if (modalmap.size > 1) {
            modalmap.delete(id)
            setTimeout(() => {
                modal.remove()
            }, 500);
            return
        }
        $("body").css("overflow", "auto");
        modalContainer.removeClass('show')
        modalContainer.addClass('hide')
        $('body').removeClass('modal-open')
        setTimeout(() => {
            modal.remove()
        }, 500);
    },
    minimizeModal: function (id) {
        const modal = modalmap.get(id)
        modal.removeClass('active')
        setTimeout(() => {
            modal.remove()
        }, 500);
    },
}

export { modalAPI, modalCreator }
export default modalCreator

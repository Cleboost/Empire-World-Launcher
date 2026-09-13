/**
 * Script for login.ejs
 */
const validUsername = /^[a-zA-Z0-9_]{3,16}$/

const loginCancelContainer = document.getElementById('loginCancelContainer')
const loginCancelButton = document.getElementById('loginCancelButton')
const loginUsernameError = document.getElementById('loginUsernameError')
const loginUsername = document.getElementById('loginUsername')
const loginButton = document.getElementById('loginButton')
const loginForm = document.getElementById('loginForm')

let usernameValid = false

function showError(element, value){
    element.innerHTML = value
    element.style.opacity = 1
}

function shakeError(element){
    if(element.style.opacity == 1){
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

function validateUsername(value){
    if(value){
        if(!validUsername.test(value)){
            showError(loginUsernameError, Lang.queryJS('offlineLogin.error.invalidValue'))
            loginDisabled(true)
            usernameValid = false
        } else {
            loginUsernameError.style.opacity = 0
            usernameValid = true
            loginDisabled(false)
        }
    } else {
        usernameValid = false
        showError(loginUsernameError, Lang.queryJS('offlineLogin.error.requiredValue'))
        loginDisabled(true)
    }
}

loginUsername.addEventListener('focusout', (e) => {
    validateUsername(e.target.value)
    shakeError(loginUsernameError)
})

loginUsername.addEventListener('input', (e) => {
    validateUsername(e.target.value)
})

function loginDisabled(v){
    if(loginButton.disabled !== v){
        loginButton.disabled = v
    }
}

function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('offlineLogin.login'), Lang.queryJS('offlineLogin.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('offlineLogin.loggingIn'), Lang.queryJS('offlineLogin.login'))
    }
}

function formDisabled(v){
    loginDisabled(v)
    loginCancelButton.disabled = v
    loginUsername.disabled = v
}

let loginViewOnSuccess = VIEWS.landing
let loginViewOnCancel = VIEWS.settings
let loginViewCancelHandler

function loginCancelEnabled(val){
    if(val){
        $(loginCancelContainer).show()
    } else {
        $(loginCancelContainer).hide()
    }
}

loginCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        loginCancelEnabled(false)
        if(loginViewCancelHandler != null){
            loginViewCancelHandler()
            loginViewCancelHandler = null
        }
    })
}

loginForm.onsubmit = () => { return false }

loginButton.addEventListener('click', () => {
    formDisabled(true)
    loginLoading(true)

    AuthManager.addOfflineAccount(loginUsername.value).then((value) => {
        updateSelectedAccount(value)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('offlineLogin.loggingIn'), Lang.queryJS('offlineLogin.success'))
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                if(loginViewOnSuccess === VIEWS.settings){
                    await prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing
                loginCancelEnabled(false)
                loginViewCancelHandler = null
                loginUsername.value = ''
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                loginLoading(false)
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('offlineLogin.success'), Lang.queryJS('offlineLogin.login'))
                formDisabled(false)
            })
        }, 1000)
    }).catch((displayableError) => {
        loginLoading(false)

        let actualDisplayableError
        if(isDisplayableError(displayableError)) {
            actualDisplayableError = displayableError
        } else {
            actualDisplayableError = Lang.queryJS('offlineLogin.error.unknown')
        }

        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
        setOverlayHandler(() => {
            formDisabled(false)
            toggleOverlay(false)
        })
        toggleOverlay(true)
    })

})

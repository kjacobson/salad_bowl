const html = require('nanohtml')
const uuid = require('uuid').v4
const ioClient = require('socket.io-client')

const API_BASE = ''
const ROUNDS = [
    'Describe the term in as many words as necessary',
    'Act out the term, but don\'t speak',
    'Use one word to evoke the term'
]

const PHASES = {
    NO_ACTIVE_GAMES: 0,
    PLAYER_SIGN_IN: 1,
    COLLECTING_TERMS: 2,
    WAITING_TO_START: 3,
    PLAY_IN_PROGRESS: 4,
    BETWEEN_PLAYERS: 5,
    DONE: 6
}

class AppState {
    constructor(state, renderFn) {
        this.state = state
        this.renderFn = renderFn
        return this
    }

    change(modifier, render = true) {
        if (typeof modifier === "function") {
            this.state = modifier(this.get())
        } else
        if (modifier) {
            this.state = modifier
        }
        if (render) {
            this.renderFn(this.get())
        }
    }

    get() {
        return this.state
    }
}

const initialState = () => {
    return {
        adminId: null,
        id: null,
        players: [],
        terms: [],
        currentRound: 0,
        turn: 0,
        currentTerm: null,
        score: [0, 0],
        currentPhase: PHASES.NO_ACTIVE_GAMES,
        playerTerms: {}
    }
}

const playerId = () => {
    return localStorage.getItem('playerId')
}

const isAdmin = adminId => {
    return adminId === playerId()
}
const hasSignedIn = players => {
    return players.find(player => {
        return player.id === playerId()
    })
}
const currentPlayer = state => {
    return state.teams[state.turn][0]
}
const isCurrentPlayer = state => { 
    return currentPlayer(state).id === playerId()
}
const getPlayerTerms = state => {
    const player = hasSignedIn(state.players)

    return state.playerTerms[player.id]
}
const hasAddedTerms = state => {
    return getPlayerTerms(state).length === state.termsPerPlayer
}
const allPlayersDoneAddingTerms =  state => {
    for (let k in state.playerTerms) {
        if (state.playerTerms[k].length < state.termsPerPlayer) {
            return false
        }
    }
    return true
}

const initLocalPlayer = id => {
    localStorage.setItem('playerId', id)
}
const addPlayerTerm = (state, term) => {
    const player = hasSignedIn(state.players)
    state.playerTerms[player.id].push(term)
}
const collectTerms = (playerTerms) => {
    let terms = []
    for (let k in playerTerms) {
        terms = terms.concat(playerTerms[k])
    }
    return terms
}


const divideTeams = players => {
    const pool = Array.from(players)
    let i = 0, team1 = [], team2 = []
    while (pool.length) {
        const recipient = i % 2 === 0 ? team1 : team2
        recipient.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
        i++
    }
    return [team1, team2]
}

const shuffle = array => {
    let terms = Array.from(array)
    let m = terms.length, t, i

    while (m) {
        i = Math.floor(Math.random() * m--)

        t = terms[m]
        terms[m] = terms[i]
        terms[i] = t
    }

    return terms
}

const saveGame = state => {
    return new Promise((resolve, reject) => {
        return fetch(API_BASE + '/games/' + state.id, {
            method: 'put',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        }).then(response => {
            if (!response.ok) {
                reject()
            }

            return response.json()
        }, err => {
            reject(err)
        }).then(resolve, err => {
            reject(err)
        })
    })
}

const createGame = (adminName, termsPerPlayer, timePerTurn) => {
    const state = getState()
    state.id = uuid()
    state.adminId = uuid() 
    state.players.push({
        id: state.adminId,
        name: adminName
    })
    state.playerTerms[state.adminId] = []
    state.timePerTurn = parseInt(timePerTurn)
    state.timeRemaining = parseInt(timePerTurn)
    state.termsPerPlayer = parseInt(termsPerPlayer)
    state.currentPhase = PHASES.PLAYER_SIGN_IN
    return new Promise((resolve, reject) => {
        return fetch(API_BASE + '/games', {
            method: 'post',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        }).then(response => {
            if (!response.ok) {
                reject()
            }

            return response.json()
        }, err => {
            reject(err)
        }).then(resolve, err => {
            reject(err)
        })
    })
}
const addPlayer = (name, playerId) => {
    const state = getState() 
    state.players.push({id: playerId, name: name})
    state.playerTerms[playerId] = []

    return saveGame(state)
}
const startGame = () => {
    const state = getState()
    state.currentPhase = PHASES.COLLECTING_TERMS

    return saveGame(state)
}
const addTerm = term => {
    const state = getState()
    const player = hasSignedIn(state.players)
    addPlayerTerm(state, term)

    if (allPlayersDoneAddingTerms(state)) {
        state.terms = collectTerms(state.playerTerms)
        return prepareToStart(state)
    } else
    if (hasAddedTerms(state)) {
        return saveGame(state)
    } else {
        changeState(state)
        return Promise.resolve(state)
    }
}
const prepareToStart = state => {
    state = state || getState()
    state.currentPhase = PHASES.WAITING_TO_START
    if (!state.teams || !state.teams.length) {
        state.teams = divideTeams(state.players)
    }

    return saveGame(state)
}
const beginGameplay = () => {
    const state = getState()
    state.currentPhase = PHASES.PLAY_IN_PROGRESS
    state.activeTerms = shuffle(state.terms)
    state.currentTerm = state.activeTerms.shift()
    tick(state)

    return saveGame(state)
}
const endTurn = () => {
    const state = getState()
    clearTimeout(state.tick)
    // put the current term back on the stack
    state.activeTerms.push(state.currentTerm)
    // move the player who just played to the end of the line
    state.teams[state.turn].push(state.teams[state.turn].shift())
    state.turn = state.turn ? 0 : 1
    state.timeRemaining = state.timePerTurn
    state.currentPhase = PHASES.BETWEEN_PLAYERS

    return saveGame(state)
}
const resumeGameplay = () => {
    const state = getState()
    state.currentPhase = PHASES.PLAY_IN_PROGRESS
    state.currentTerm = state.activeTerms.shift()
    tick(state)

    return saveGame(state)
}
const changeRound = (state) => {
    state = state || getState()
    clearTimeout(state.tick)

    if (state.currentRound < 2) {
        // move the player who just played to the end of the line
        state.currentRound++
        state.currentPhase = PHASES.WAITING_TO_START
        state.currentTerm = null
    } else {
        return endGame()
    }
    return saveGame(state)
}
const successfulGuess = () => {
    const state = getState()

    state.score[state.turn]++
    const nextTerm = state.activeTerms.shift()
    if (nextTerm) {
        state.currentTerm = nextTerm
    } else {
        return changeRound(state)
    }

    return saveGame(state)
}
const endGame = () => {
    const state = getState()
    state.currentPhase = PHASES.DONE

    return saveGame(state)
}

const tick = () => {
    state = getState()
    let timer
    if (state.timeRemaining > 0) {
        timer = setTimeout(tick, 1000)
    } else {
        return endTurn()
    }
    changeState(s => {
        s.tick = timer
        s.timeRemaining--
        const el = document.getElementById('timer')
        if (el) {
            el.innerHTML = ':' + s.timeRemaining
        }
        return s
    }, false)
}


const handleNewGame = e => {
    e.preventDefault()
    const name = document.getElementById('playerName').value
    const terms = document.getElementById('termsPerPlayer').value
    const time = document.getElementById('timePerTurn').value
    
    return createGame(name, terms, time).then(data => {
        initLocalPlayer(data.adminId)
        window.location = window.location.href + '?/games/' + data.id
    }, err => {
        console.error(err)
    })
}
const newGame = state => {
    return  html`<h1>Start a new game</h1><form onsubmit="${handleNewGame}">
        <label for="playerName">Your name:</label><br />
        <input id="playerName" type="text" placeholder="your name" required /><br /><br />

        <label for="termsPerPlayer">Terms per player:</label><br />
        <input id="termsPerPlayer" type="number" size="2" value="3" required /><br /><br />

        <label for="timePerTurn">Length of turn:</label><br />
        <select id="timePerTurn">
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
            <option value="45">45 seconds</option>
            <option value="60" selected>60 seconds</option>
        </select><br /><br />
        <button type="submit">New game</button>
    </form>`
}


const handleAddPlayer = e => {
    e.preventDefault()
    const input = document.getElementById('playerName')
    const name = input.value
    const playerId = uuid()

    if (name) {
        return addPlayer(name, playerId).then(data => {
            initLocalPlayer(playerId)
            return changeState(data)
        }, err => {
            console.error(err)
        })
    }
}
const handleStartGame = e => {
    e.preventDefault()
    return startGame().then(data => {
        return changeState(data)
    }, err => {
        console.error(err)
    })
}
const logIn = state => {
    return hasSignedIn(state.players)
        ? html`<h1>Waiting on other players. </h1>
            <h2>Share this link to let them join:</h2>
            <a href="?/games/${state.id}">${window.location.href}</a>
            <br />
            <br />
            ${isAdmin(state.adminId) ? html`When you're ready, click this button:<br /><button onclick="${handleStartGame}">Start game</button>` : ''}
        </p><ul>
            ${state.players.map((player) => {
                return html`<li>${player.name}</li>`
            })}
        </ul>`
        : html`<h1>You've been invited to join a game of celebrity</h1>
            <h2>Add your name to start</h2>
            <form onsubmit=${handleAddPlayer}>
                <input id="playerName" type="text" placeholder="your name" required />
                <button type="submit">Sign in</button>
            </form>`
}


const enterTerm = () => {
    let contents = ''

    const handleKeyUp = e => {
        contents = e.target.value
    }

    const handleEnterTerm = e => {
        e.preventDefault()
        const term = document.getElementById('term').value
        contents = ''
        return addTerm(term).then(data => {
            return changeState(data)
        })
    }

    return (state) => {
        return html`
            <h1>Enter ${state.termsPerPlayer} terms</h1>
            <form onsubmit=${handleEnterTerm}>
                <input type="text" required id="term" size="48" placeholder="Enter a person, place OR thing (one at a time!)" value="${contents}" onkeyup="${handleKeyUp}" />
                <button>Add term</button>
            </form>
        `
    }
}
const enterTermPage = enterTerm()

const collectingTerms = state => {
    const playerTerms = getPlayerTerms(state)
    const terms = playerTerms.length ? html`<ul>${playerTerms.map(term => html`<li>${term}</li>`)}</ul>` : '...'

    return html`
        ${hasAddedTerms(state)
            ? html`<p>Waiting on other players to finishing adding terms.</p>`
            : enterTermPage(state)
        }
        <h2>Your terms:</h2>${terms || '...'}
    `
}

const handleBeginGameplay = e => {
    e.preventDefault()

    return beginGameplay().then(data => {
        return changeState(data)
    })
}
const waitingToStart = state => {
    return html`<p>
        <h1>Round ${state.currentRound + 1}: ${ROUNDS[state.currentRound]}</h1>
        ${state.currentRound === 0 ? 'Everyone has entered terms.' : ''}<br />
        <strong>Team 1:</strong><br />
        Players: ${state.teams[0].map(player => player.name).join(', ')}<br />
        Score: ${state.score[0]}<br /><br />

        <strong>Team 2:</strong><br />
        Players: ${state.teams[1].map(player => player.name).join(', ')}<br />
        Score: ${state.score[1]}<br /><br />
        
        ${state.timeRemaining < state.timePerTurn
            ? html`<strong>${currentPlayer(state).name}</strong> continues their turn with ${state.timeRemaining} seconds remaining<br />`
            : html`<strong>${currentPlayer(state).name}</strong> is up first for <strong>team ${state.turn + 1}</strong></br />`
        }
        
        ${isCurrentPlayer(state) ? html`<button onclick="${handleBeginGameplay}">Begin round ${state.currentRound + 1}</button>` : ''} 
    </p>` 
}

const handleNextTerm = e => {
    e.preventDefault()

    return successfulGuess().then(data => {
        delete data.currentTerm
        delete data.timeRemaining
        delete data.activeTerms
        return changeState(s => Object.assign({}, s, data))
    })
}
const playInProgress = state => {
    return isCurrentPlayer(state)
        ? html`
            <h1>${state.currentTerm}</h1>
            <span id="timer">:${state.timeRemaining}</span><br />
            ${html`<button onclick=${handleNextTerm}>Next term</button>`}
        `
        : html`
            <h1>Round ${state.currentRound + 1}: ${ROUNDS[state.currentRound]}</h1>
            <h2>Current player: ${currentPlayer(state).name}</h2>
            <h3>${state.timeRemaining}</h3>
        `
}

const handleResumeGameplay = e => {
    e.preventDefault()

    return resumeGameplay().then(data => {
        return changeState(data)
    })
}
const betweenPlayers = state => {
    return html`<p>
        <h1>Round ${state.currentRound + 1}: ${ROUNDS[state.currentRound]}</h1>
        <strong>Team 1:</strong><br />
        Players: ${state.teams[0].map(player => player.name).join(', ')}<br />
        Score: ${state.score[0]}<br /><br />

        <strong>Team 2:</strong><br />
        Players: ${state.teams[1].map(player => player.name).join(', ')}<br />
        Score: ${state.score[1]}<br /><br />
        
        <strong>${currentPlayer(state).name}</strong> is up next for <strong>team ${state.turn + 1}</strong></br />
        ${isCurrentPlayer(state) ? html`<button onclick="${handleResumeGameplay}">Go</button>` : ''} 
    </p>` 
}

const gameOver = state => {
    const [team1, team2] = state.score
    let headline
    if (team1 > team2) {
        headline = "Team 1 wins!"
    } else
    if (team2 > team1) {
        headline = "Team 2 wins!"
    } else {
        headline = "It's a tie!"
    }
    return html`<div>
        <h1>${headline}</h1>

        <strong>Team 1:</strong><br />
        Players: ${state.teams[0].map(player => player.name).join(', ')}<br />
        Score: ${state.score[0]}<br /><br />

        <strong>Team 2:</strong><br />
        Players: ${state.teams[1].map(player => player.name).join(', ')}<br />
        Score: ${state.score[1]}
    </div>`
}
const moveCursorToEnd = (el) => {
    if (typeof el.selectionStart === "number") {
        el.selectionStart = el.selectionEnd = el.value.length
    } else if (typeof el.createTextRange !== "undefined") {
        el.focus()
        const range = el.createTextRange()
        range.collapse(false)
        range.select()
    }
    el.focus()
}

const render = state => {
    const el = html`<main id="main">${body(state)}</main>`
    document.body.replaceChild(el, document.getElementById('main'))

    const inputs = document.querySelectorAll('input[type="text"]')
    if (inputs.length) {
        Array.from(inputs).map(moveCursorToEnd)
    }
}

const body = state => {
    switch (state.currentPhase) {
        case PHASES.NO_ACTIVE_GAMES:
            return newGame(state)
        case PHASES.PLAYER_SIGN_IN:
            return logIn(state)
        case PHASES.COLLECTING_TERMS:
            return collectingTerms(state)
        case PHASES.WAITING_TO_START:
            return waitingToStart(state)
        case PHASES.PLAY_IN_PROGRESS:
            return playInProgress(state)
        case PHASES.BETWEEN_PLAYERS:
            return betweenPlayers(state)
        case PHASES.DONE:
            return gameOver(state)
    }
}
const URL_REGEX = /(\/games\/[a-f0-9]{8}\-[a-f0-9]{4}\-[a-f0-9]{4}\-[a-f0-9]{4}\-[a-f0-9]{12})/

let getState, changeState
const init = async () => {
    const state = new AppState(initialState(), render)
    getState = state.get.bind(state)
    changeState = state.change.bind(state)

    const io = ioClient()
    io.on('update', data => {
        if (data.id === getState().id) {
            const player = hasSignedIn(data.players)
            // don't let current player lose a race when adding terms
            if (player) {
                data.playerTerms[player.id] = state.get().playerTerms[player.id]
            }
            state.change(data)
        }
    })
    try {
        const match = window.location.href.match(URL_REGEX)
        const data = await fetch(API_BASE + match[1] + '/').then(response => {
            return response.json()
        })
        if (data.currentPhase === PHASES.PLAY_IN_PROGRESS && isCurrentPlayer(data)) {
            tick(data)
        }
        state.change(data)
    }
    catch(err) {
        state.change()
    }
}

init()

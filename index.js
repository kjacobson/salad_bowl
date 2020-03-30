const html = require('nanohtml')
const uuid = require('uuid').v4
const ioClient = require('socket.io-client')

const API_BASE = `http://localhost:3000`
const TERMS_PER_PLAYER = 2
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
    BETWEEN_ROUNDS: 5,
    DONE: 6
}

class AppState {
    constructor(state, renderFn) {
        this.state = state
        this.renderFn = renderFn
        return this
    }

    change(modifier) {
        if (typeof modifier === "function") {
            this.state = modifier(this.get())
        } else
        if (modifier) {
            this.state = modifier
        }

        this.renderFn(this.get())
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
        timeRemaining: 60,
        currentPhase: PHASES.NO_ACTIVE_GAMES
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
const hasAddedTerms = players => {
    const player = hasSignedIn(players)

    if (player) {
        return getPlayerTerms().length === TERMS_PER_PLAYER
    }
    return false
}
const allPlayersDoneAddingWords = state => {
    return state.terms.length === state.players.length * TERMS_PER_PLAYER
}

const initLocalPlayer = id => {
    localStorage.setItem('playerId', id)
    localStorage.setItem('terms', JSON.stringify([]))
}
const getPlayerTerms = () => {
    return JSON.parse(localStorage.getItem('terms')) || []
}
const addPlayerTerm = term => {
    const terms = getPlayerTerms()
    terms.push(term)
    localStorage.setItem('terms', JSON.stringify(terms))
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
    let terms = Array.from(array), i, j
    for (i = terms.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1))
        [terms[i], terms[j]] = [terms[j], terms[i]]
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

const createGame = adminName => {
    const state = getState()
    state.id = uuid()
    state.adminId = uuid() 
    state.players.push({
        id: state.adminId,
        name: adminName
    })
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
    state.terms.push(term)

    if (allPlayersDoneAddingWords(state)) {
        return prepareToStart(state)
    }
    return saveGame(state)
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
    state.currentTerm = state.activeTerms.pop()
    tick(state)

    return saveGame(state)
}
const endTurn = () => {
    const state = getState()
    const player = state.teams[state.turn].pop()
    state.teams[state.turn].push(player)
    state.turn = state.turn ? 0 : 1
    state.currentPhase = PHASES.WAITING_TO_START

    return saveGame(state)
}
const changeRound = (state) => {
    state = state || getState()

    if (state.currentRound < 2) {
        state.currentRound++
        state.timeRemaining = 60
        state.currentPhase = PHASES.BETWEEN_ROUNDS
    } else {
        return endGame()
    }
    return saveGame(state)
}
const successfulGuess = () => {
    const state = getState()

    state.score[state.turn]++
    const nextTerm = state.activeTerms.pop()
    if (nextTerm) {
        state.currentTerm = nextTerm
    } else {
        changeRound(state)
    }

    return saveGame(state)
}

const tick = () => {
    state = getState()
    if (state.timeRemaining > 0) {
        setTimeout(tick, 1000)
    } else {
        endTurn()
    }
    changeState(s => {
        s.timeRemaining--
        if (s.timeRemaining % 10 === 0) {
            saveGame(s)
        }
        return s
    })
}


const handleNewGame = e => {
    e.preventDefault()
    const input = document.getElementById('playerName')
    const name = input.value
    
    return createGame(name).then(data => {
        initLocalPlayer(data.adminId)
        return changeState(s => {
            return Object.assign({}, s, data)
        })
    }, err => {
        console.error(err)
    })
}
const newGame = state => {
    return  html`<form onsubmit="${handleNewGame}">
        <input id="playerName" type="text" placeholder="your name" required />
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
        ? html`<p>Waiting on other players. <br />
            <a href="?/games/${state.id}">?/games/${state.id}</a><br />
            ${isAdmin(state.adminId) ? html`<button onclick="${handleStartGame}">Start game</button>` : ''}
        </p><ul>
            ${state.players.map((player) => {
                return html`<li>${player.name}</li>`
            })}
        </ul>`
        : html`<form onsubmit=${handleAddPlayer}> <input id="playerName" type="text" placeholder="your name" required />
            <button type="submit">Sign in</button></form>`
}


const handleEnterTerm = e => {
    e.preventDefault()
    const term = document.getElementById('term').value
    return addTerm(term).then(data => {
        addPlayerTerm(term)
        return changeState(data)
    })
}
const enterTerm = state => {
    return html`
        <form onsubmit=${handleEnterTerm}>
            <input type="text" required id="term" placeholder="person, place, thing" />
            <button>Add term</button>
        </form>
    `
}

const collectingTerms = state => {
    const terms = html`<ul>${getPlayerTerms().map(term => html`<li>${term}</li>`)}</ul>`

    return html`
        <h2>Your terms</h2><ul>${terms}</ul>
        ${hasAddedTerms(state.players)
            ? html`<p>Waiting on other players to finishing adding terms.</p>`
            : enterTerm(state)
        }
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
        Everyone has entered terms.<br />
        Team 1: ${state.teams[0].map(player => player.name).join(', ')}<br />
        Team 2: ${state.teams[1].map(player => player.name).join(', ')}<br />
        <strong>${currentPlayer(state).name}</strong> is up first for <strong>Team ${state.turn + 1}</strong></br />
        ${isCurrentPlayer(state) ? html`<button onclick="${handleBeginGameplay}">Begin round ${state.currentRound + 1}</button>` : ''} 
    </p>` 
}

const handleNextTerm = e => {
    e.preventDefault()

    return successfulGuess().then(data => {
        return changeState(data)
    })
}
const playInProgress = state => {
    return isCurrentPlayer(state)
        ? html`<h1>${state.currentTerm} <button onclick="${handleNextTerm}">Next term</button></h1><span>${state.timeRemaining}</span>`
        : html`
            <h1>Round ${state.currentRound + 1}: ${ROUNDS[state.currentRound]}</h1>
            <h2>Current player: ${currentPlayer(state).name}</h2>
            <h3>${state.timeRemaining}</h3>
        `
}

const betweenRounds = state => {
    return html`
        <h1>Next round: ${ROUNDS[state.currentRound]}</h1>
    `
}

const render = state => {
    const el = html`<main id="main">${body(state)}</main>`
    document.body.replaceChild(el, document.getElementById('main'))
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
        case PHASES.BETWEEN_ROUNDS: 
            return betweenRounds(state)
        case PHASES.DONE:
            return ''
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
        state.change(data)
    })
    try {
        const match = window.location.href.match(URL_REGEX)
        const data = await fetch(API_BASE + match[1] + '/').then(response => {
            return response.json()
        })
        state.change(data)
    }
    catch(err) {
        state.change()
    }
}

init()

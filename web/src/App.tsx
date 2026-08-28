import { Route, Router } from '@solidjs/router'
import { LobbyPage } from './pages/Lobby'
import { AuthPage } from './pages/Auth'
import { CardsPage } from './pages/Cards'

function App() {
  return (
    <Router>
      <Route path="/" component={LobbyPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/cards" component={CardsPage} />
    </Router>
  )
}

export default App

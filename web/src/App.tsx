import { Route, Router } from '@solidjs/router'
import { LobbyPage } from './pages/Lobby'
import { AuthPage } from './pages/Auth'
import { CardsPage } from './pages/Cards'
import { TablePage } from './pages/Table'

function App() {
  return (
    <Router>
      <Route path="/" component={LobbyPage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/cards" component={CardsPage} />
      <Route path="/table/:id" component={TablePage} />
    </Router>
  )
}

export default App

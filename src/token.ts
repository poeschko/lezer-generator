import {Term, union} from "./grammar"

export const MAX_CHAR = 0xffff

export class Edge {
  constructor(readonly from: number, readonly to: number = from + 1, readonly target: State) {}

  toString() {
    return `-> ${this.target.id}[label=${JSON.stringify(
      this.from < 0 ? "ε" : charFor(this.from) +
        (this.to > this.from + 1 ? "-" + charFor(this.to - 1) : ""))}]`
  }
}

function charFor(n: number) {
  return n > MAX_CHAR ? "∞" : n >= 0xd800 && n < 0xdfff ? "\\u{" + n.toString(16) + "}" : String.fromCharCode(n)
}

let stateID = 1

export class State {
  edges: Edge[] = []

  constructor(readonly accepting: Term[] = [], readonly id = stateID++) {}

  edge(from: number, to: number = from + 1, target: State) {
    this.edges.push(new Edge(from, to, target))
  }

  nullEdge(target: State) { this.edge(-1, -1, target) }

  compile() {
    let labeled: {[id: string]: State} = Object.create(null), localID = 0
    return explore(this.closure().sort((a, b) => a.id - b.id))

    function explore(states: State[]) {
      let newState = labeled[ids(states)] =
        new State(states.reduce((a: readonly Term[], s: State) => union(a, s.accepting), []) as Term[], localID++)
      let out: Edge[] = []
      for (let state of states) for (let edge of state.edges) {
        if (edge.from >= 0) out.push(edge)
      }
      let transitions = mergeEdges(out)
      for (let merged of transitions) {
        let targets = merged.targets.sort((a, b) => a.id - b.id)
        newState.edge(merged.from, merged.to, labeled[ids(targets)] || explore(targets))
      }
      return newState
    }
  }

  closure() {
    let result: State[] = []
    function explore(state: State): void {
      if (result.includes(state)) return
      // States with only epsilon edges and no accepting term that
      // isn't also in the next states are left out to help reduce the
      // number of unique state combinations
      if (state.edges.some(e => e.from >= 0) ||
          (state.accepting.length > 0 && !state.edges.some(e => sameSet(state.accepting, e.target.accepting))))
        result.push(state)
      for (let edge of state.edges) if (edge.from < 0) explore(edge.target)
    }
    explore(this)
    return result
  }

  findConflicts(): Conflict[] {
    let conflicts: Conflict[] = [], cycles = this.cycleStates()
    function add(a: Term, b: Term) {
      if (a.id < b.id) [a, b] = [b, a]
      if (!conflicts.some(c => c.a == a && c.b == b)) conflicts.push(new Conflict(a, b))
    }
    this.reachable(state => {
      if (state.accepting.length == 0) return
      for (let i = 0; i < state.accepting.length; i++)
        for (let j = i + 1; j < state.accepting.length; j++)
          add(state.accepting[i], state.accepting[j])
      let inCycle = cycles.includes(state)
      state.reachable(s => {
        if (s != state && (inCycle || cycles.includes(s)))
          for (let term of s.accepting)
            for (let orig of state.accepting)
              if (term != orig) add(term, orig)
      })
    })
    return conflicts
  }

  cycleStates(): State[] {
    let result: State[] = []
    ;(function explore(state: State, seen: State[]) {
      let found = seen.indexOf(state)
      if (found > -1) {
        for (let i = found; i < seen.length; i++) {
          if (!result.includes(seen[i])) result.push(seen[i])
        }
      } else {
        seen.push(state)
        for (let edge of state.edges) explore(edge.target, seen)
        seen.pop()
      }
    }(this, []))
    return result
  }

  reachable(f: (s: State) => void) {
    let seen: State[] = []
    ;(function explore(s: State) {
      f(s)
      seen.push(s)
      for (let edge of s.edges)
        if (!seen.includes(edge.target)) explore(edge.target)
    })(this)
  }

  toString() {
    let out = "digraph {\n"
    this.reachable(state => {
      if (state.accepting.length)
        out += `  ${state.id} [label=${state.accepting.join()}];\n`
      for (let edge of state.edges)
        out += `  ${state.id} ${edge};\n`
    })
    return out + "}"
  }

  // Tokenizer data is represented using arrays of numbers. The array
  // for a state starts with the state's mask (the logical or of all
  // the masks of the terminals that can be reached from it), which is
  // used for abandoning a scan when it can't reach any applicable
  // tokens.
  //
  // Next follows the number of accepting tokens for this state,
  // followed by term id, token mask pairs for each of those.
  //
  // After that follow the edges going out of the state, consisting of
  // from, to, state id triplets.
  toArrays(groupMasks: {[id: number]: number}, precedence: readonly number[]) {
    let arrays: number[][] = []
    this.reachable(state => {
      let array = [state.stateMask(groupMasks), state.accepting.length]
      state.accepting.sort((a, b) => precedence.indexOf(a.id) - precedence.indexOf(b.id))
      for (let term of state.accepting) array.push(term.id, groupMasks[term.id] || 0xffff)
      for (let edge of state.edges) array.push(edge.from, edge.to, edge.target.id)
      arrays.push(array)
    })
    return arrays
  }

  stateMask(groupMasks: {[id: number]: number}) {
    let mask = 0
    this.reachable(state => {
      for (let term of state.accepting) mask |= (groupMasks[term.id] || 0xffff)
    })
    return mask
  }
}

export class Conflict {
  constructor(readonly a: Term, readonly b: Term) {}
}

function ids(states: State[]) {
  let result = ""
  for (let state of states) result += (result.length ? "-" : "") + state.id
  return result
}

function sameSet<T>(a: readonly T[], b: readonly T[]) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] != b[i]) return false
  return true
}

class MergedEdge {
  constructor(readonly from: number, readonly to: number, readonly targets: State[]) {}
}

// Merge multiple edges (tagged by character ranges) into a set of
// mutually exclusive ranges pointing at all target states for that
// range
function mergeEdges(edges: Edge[]): MergedEdge[] {
  let separate: number[] = [], result: MergedEdge[] = []
  for (let edge of edges) {
    if (!separate.includes(edge.from)) separate.push(edge.from)
    if (!separate.includes(edge.to)) separate.push(edge.to)
  }
  separate.sort((a, b) => a - b)
  for (let i = 1; i < separate.length; i++) {
    let from = separate[i - 1], to = separate[i]
    let found: State[] = []
    for (let edge of edges) if (edge.to > from && edge.from < to) {
      for (let target of edge.target.closure()) if (!found.includes(target))
        found.push(target)
    }
    if (found.length) result.push(new MergedEdge(from, to, found))
  }
  return result
}

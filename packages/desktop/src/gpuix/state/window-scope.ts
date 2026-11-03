import { createContext, useContext } from 'react'

export const WindowScopeContext = createContext('main')
export const useWindowScope = (): string => useContext(WindowScopeContext)

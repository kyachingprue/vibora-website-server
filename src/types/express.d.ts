declare global {
  namespace Express {
    interface Request {
      /** Set by the requireAuth / optionalAuth middleware */
      user?: { id: string }
    }
  }
}

export {}

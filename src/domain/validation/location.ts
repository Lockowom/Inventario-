import { z } from 'zod'

export const locationSchema = z.string().regex(
  /^(?:TECHO|(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2})$/,
  'Ubicación mal digitada. Use TECHO o el formato de pasillo F-32-03 / C2-32-03.',
)

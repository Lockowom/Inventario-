import { z } from 'zod'

export const locationSchema = z.string().regex(
  /^(A|B|C|C2|D|F|G|H|I)-[0-9]{2}-[0-9]{2}$/,
  'Ubicación mal digitada. Verifique el formato y el pasillo. Ejemplos válidos: F-32-03 o C2-32-03.',
)


import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const supabaseUrl = 'https://etxlpwasuhlezdfczfte.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0eGxwd2FzdWhsZXpkZmN6ZnRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk5ODQyMTAsImV4cCI6MjA2NTU2MDIxMH0.cVet_wfjXH56l9sCcwaklnguEax7vPRv2ShrJeun7x0'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

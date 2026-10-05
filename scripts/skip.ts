import { runMissedWorkout } from './lib/missed-workout-cli'

try {
  runMissedWorkout('skip')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

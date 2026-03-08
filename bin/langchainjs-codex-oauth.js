#!/usr/bin/env node

import { main } from "../dist/bin.mjs"

await main(process.argv.slice(2))

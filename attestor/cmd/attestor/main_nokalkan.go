//go:build !kalkan

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "attestor: build with -tags kalkan (needs the NCA KalkanCrypt SDK in pkisdk/)")
	os.Exit(1)
}

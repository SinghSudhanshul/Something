package wallet

import "errors"

var (
	ErrWalletNotFound      = errors.New("wallet not found")
	ErrWalletFrozen        = errors.New("wallet is frozen")
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrDailyLimitExceeded  = errors.New("daily spending limit exceeded")
	ErrSelfTransfer        = errors.New("cannot transfer to yourself")
	ErrDuplicateOperation  = errors.New("operation already processed")
	ErrTransactionNotFound = errors.New("transaction not found")
	ErrInvalidAmount       = errors.New("amount must be positive")
	ErrEscrowNotHeld       = errors.New("transaction is not in escrow")
)

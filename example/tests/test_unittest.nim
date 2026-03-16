import unittest

suite "Standard Unittest Suite":
  test "Standard Test A (Pass)":
    check 1 + 1 == 2
  test "Standard Test B (Fail)":
    check 1 + 1 == 3
  test "Standard Test C (Error)":
    expect ValueError:
      raise newException(ValueError, "Oops")

import unittest2

suite "Suite 1":
  test "Test A":
    check 1 + 1 == 2
  test "Test B":
    check 1 + 1 == 3

suite "Suite 2":
  test "Test C":
    expect ValueError:
      raise newException(ValueError, "Error")

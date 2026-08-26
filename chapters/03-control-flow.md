# Control Flow

Control flow determines the order in which statements execute. Python uses conditional statements and loops to control execution.

## Conditional Statements

### if Statements

An `if` statement runs a block of code only when a condition is true:

```python
age = 18

if age >= 18:
    print("You are an adult")
```

### if-else Statements

Add an `else` block for when the condition is false:

```python
age = 15

if age >= 18:
    print("You are an adult")
else:
    print("You are a minor")
```

### if-elif-else Chains

Use `elif` for multiple conditions:

```python
score = 85

if score >= 90:
    grade = "A"
elif score >= 80:
    grade = "B"
elif score >= 70:
    grade = "C"
elif score >= 60:
    grade = "D"
else:
    grade = "F"

print(f"Your grade is {grade}")
```

## Loops

### for Loops

A `for` loop iterates over a sequence:

```python
fruits = ["apple", "banana", "cherry"]

for fruit in fruits:
    print(fruit)
```

### range()

The `range()` function generates numbers:

```python
for i in range(5):
    print(i)  # 0, 1, 2, 3, 4

for i in range(1, 4):
    print(i)  # 1, 2, 3
```

### while Loops

A `while` loop runs as long as a condition is true:

```python
count = 0

while count < 5:
    print(count)
    count += 1
```

## break and continue

- `break` exits the loop immediately
- `continue` skips to the next iteration

```python
for i in range(10):
    if i == 3:
        continue  # skip 3
    if i == 7:
        break     # stop at 7
    print(i)
```

Output:

```text
0
1
2
4
5
6
```

## Summary

| Statement  | Purpose                         |
| ---------- | ------------------------------- |
| `if`       | Run code if a condition is true |
| `elif`     | Check another condition         |
| `else`     | Run if no conditions matched    |
| `for`      | Iterate over a sequence         |
| `while`    | Loop while a condition is true  |
| `break`    | Exit a loop                     |
| `continue` | Skip to next iteration          |

## Next Steps

You now know how to store data and control execution flow. The next topics would cover functions, lists, dictionaries, and file I/O — building blocks for writing real programs.

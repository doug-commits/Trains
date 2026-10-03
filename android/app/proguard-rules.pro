# R8 shrinks and optimises the release build (see build.gradle.kts).
#
# It does not rename. Obfuscating a single activity hides nothing worth
# hiding, and renamed classes make every crash report in Play Console
# unreadable unless a mapping file is uploaded beside every release — a step
# that is easy to forget and impossible to do afterwards. Readable stack
# traces are worth more here than the few kilobytes renaming would save.
-dontobfuscate

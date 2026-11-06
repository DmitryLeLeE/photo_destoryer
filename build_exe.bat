@echo off
rem Builds a Windows app with PyInstaller.
rem Default is --onedir (a folder): it starts faster and is flagged by antivirus far less often
rem than a single self-extracting exe. Zip the dist\PhotoDestroyer folder to share it.
py -m pip install -r requirements.txt pyinstaller
py -m PyInstaller --noconfirm --windowed --name PhotoDestroyer --collect-submodules PIL app.py
echo.
echo Done: dist\PhotoDestroyer\PhotoDestroyer.exe
rem For a single file instead, add --onefile to the PyInstaller line.

FROM python:3.12-slim
COPY main.py .
USER 10001
CMD ["python", "-u", "main.py"]
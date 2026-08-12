FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY src/CreditCalc.Api/CreditCalc.Api.csproj src/CreditCalc.Api/
RUN dotnet restore src/CreditCalc.Api/CreditCalc.Api.csproj
COPY . .
RUN dotnet publish src/CreditCalc.Api/CreditCalc.Api.csproj -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "CreditCalc.Api.dll"]
